import type { MastraModelConfig } from '@mastra/core/llm';
import type { RequestContext } from '@mastra/core/request-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Shape of the Agent constructor configuration this spec asserts on. The
// constructor arguments ARE the contract between summarize-agent.ts and
// Mastra, so capturing them at the (un-importable) library boundary is the
// observable behavior here (mirrors suggest-path-agent.spec.ts / growi-agent.spec.ts).
type CapturedAgentConfig = {
  id?: string;
  name?: string;
  instructions?: unknown;
  model?: unknown;
  tools?: Record<string, unknown>;
  memory?: unknown;
};

const captured = vi.hoisted(() => ({
  // Every Agent built in this module graph lands here (growiAgent and
  // suggestPathAgent are also constructed when the registration tests load
  // mastra-modules/index.ts), so entries are looked up by id.
  agentConfigs: [] as CapturedAgentConfig[],
}));

// Mastra's `@mastra/core/agent` cannot be imported under vitest: the monorepo
// pins `p-map@4` for Mastra (pnpm override `@mastra/core>p-map: 4.0.0`) and
// v4 has no `pMapSkip` named export, so the ESM build fails at module link.
// The StubAgent pattern mirrors suggest-path-agent.spec.ts / growi-agent.spec.ts:
// store the constructor config and assert on it.
vi.mock('@mastra/core/agent', () => {
  class StubAgent {
    name: string;

    constructor(config: CapturedAgentConfig) {
      captured.agentConfigs.push(config);
      this.name = config.name ?? config.id ?? 'stub-agent';
    }
  }
  return { Agent: StubAgent };
});

// Stub the Mastra registry class too (`@mastra/core/mastra` shares the ESM
// chunks affected by the p-map override).
vi.mock('@mastra/core/mastra', () => {
  class StubMastra {
    private readonly registeredAgents: Record<string, unknown>;

    constructor(config: { agents?: Record<string, unknown> }) {
      this.registeredAgents = config.agents ?? {};
    }

    getAgent(id: string): unknown {
      return this.registeredAgents[id];
    }
  }
  return { Mastra: StubMastra };
});

// Suppress logger noise from transitively-imported modules.
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

// The resolver is the single seam this module depends on for model supply.
// A hoisted mutable holder lets each test choose the resolution that
// `resolveMastraModel(modelKey?)` returns. The mock mirrors growi-agent.ts's
// usage (async, takes an optional modelKey), since summarize-agent.ts reads
// modelKey from requestContext the same way.
const resolverMock = vi.hoisted(() => ({
  fn: vi.fn<(modelKey?: string) => MastraModelConfig>(),
}));

vi.mock('../../../ai-sdk-modules/resolve-mastra-model', () => ({
  resolveMastraModel: async (modelKey?: string) => resolverMock.fn(modelKey),
}));

// Replace memory with an inert stub: mastra-modules/index.ts (loaded by the
// registration tests) also pulls in growi-agent.ts -> ../memory, which would
// spin up MongoDBStore at module load. Both resolve to the same module.
vi.mock('../../memory', () => ({
  memory: { id: 'stub-memory' },
}));

// A sentinel model. The agent must hand back exactly this object from its
// `model()` function when resolution succeeds.
const sentinelModel = { id: 'sentinel-model' } as unknown as MastraModelConfig;

// Importing summarizeAgent is the act under test for lazy resolution: module
// load (and thus `new Agent(...)`) must complete WITHOUT calling the resolver.
resolverMock.fn.mockImplementation(() => {
  throw new Error('Mastra LLM provider is not configured (set AI_PROVIDER)');
});

import { memory as mockedMemory } from '../../memory';
import { SUMMARIZE_INSTRUCTIONS } from './instructions';
import { limitedGetPageContentTool } from './limited-get-page-content-tool';
import type { SummarizeRequestContextShape } from './request-context';
import { summarizeAgent } from './summarize-agent';

// Snapshot whether the resolver was touched during the import above.
const resolverCalledDuringImport = resolverMock.fn.mock.calls.length > 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getCapturedConfig = (): CapturedAgentConfig => {
  const config = captured.agentConfigs.find((c) => c.id === 'summarizeAgent');
  if (config == null) {
    throw new Error('summarizeAgent constructor config was not captured');
  }
  return config;
};

type ModelFnArg = {
  requestContext: RequestContext<SummarizeRequestContextShape>;
};
type ModelFn = (arg: ModelFnArg) => Promise<MastraModelConfig>;

const getModelFn = (): ModelFn => {
  const { model } = getCapturedConfig();
  if (typeof model !== 'function') {
    throw new Error('model is expected to be a DynamicArgument function');
  }
  return model as ModelFn;
};

const makeModelFnArg = (modelKey?: string): ModelFnArg => {
  const requestContext = {
    get: (key: string): unknown => (key === 'modelKey' ? modelKey : undefined),
  } as unknown as RequestContext<SummarizeRequestContextShape>;
  return { requestContext };
};

beforeEach(() => {
  resolverMock.fn.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('summarizeAgent', () => {
  describe('agent identity', () => {
    it("is constructed with id 'summarizeAgent' (the registry retrieval key) and a display name", () => {
      const config = getCapturedConfig();

      expect(config.id).toBe('summarizeAgent');
      expect(config.name).toBe('Summarize Agent');
    });
  });

  describe('tools composition (Requirement 1.4 — cross-agent thread replay)', () => {
    it('registers limitedGetPageContentTool under the key "getPageContentTool" (same key growiAgent uses)', () => {
      const config = getCapturedConfig();

      expect(config.tools?.getPageContentTool).toBe(limitedGetPageContentTool);
    });

    it('exposes exactly one tool', () => {
      const config = getCapturedConfig();

      expect(Object.keys(config.tools ?? {})).toEqual(['getPageContentTool']);
    });

    it('does not register the raw getPageContentTool directly (only the budget-limited wrapper)', async () => {
      const { getPageContentTool } = await import(
        '../../tools/get-page-content-tool'
      );
      const config = getCapturedConfig();

      expect(config.tools?.getPageContentTool).not.toBe(getPageContentTool);
    });
  });

  describe('memory (Requirement 1.4 — follow-up questions need thread history)', () => {
    it('connects the shared memory instance', () => {
      const config = getCapturedConfig();

      expect(config.memory).toBe(mockedMemory);
    });
  });

  describe('dynamic model', () => {
    it('passes model as a function (DynamicArgument), not a static model instance', () => {
      const config = getCapturedConfig();

      expect(typeof config.model).toBe('function');
    });

    it('constructs without invoking the resolver, so a disabled config cannot throw at import', () => {
      expect(summarizeAgent).toBeDefined();
      expect(resolverCalledDuringImport).toBe(false);
    });

    it('forwards the requestContext modelKey to the resolver', async () => {
      resolverMock.fn.mockReturnValue(sentinelModel);

      const modelFn = getModelFn();
      await modelFn(makeModelFnArg('openai/gpt-4o-mini'));

      expect(resolverMock.fn).toHaveBeenCalledWith('openai/gpt-4o-mini');
    });

    it('passes undefined to the resolver when no modelKey is set, so the default is used', async () => {
      resolverMock.fn.mockReturnValue(sentinelModel);

      const modelFn = getModelFn();
      await modelFn(makeModelFnArg());

      expect(resolverMock.fn).toHaveBeenCalledWith(undefined);
    });

    it('resolves to the resolved model when resolution succeeds', async () => {
      resolverMock.fn.mockReturnValue(sentinelModel);

      const modelFn = getModelFn();

      await expect(modelFn(makeModelFnArg())).resolves.toBe(sentinelModel);
    });

    it('propagates the resolver rejection at use time without swallowing it', async () => {
      const resolverError = new Error(
        'Mastra LLM API key is not configured for provider "openai" (set AI_API_KEY)',
      );
      resolverMock.fn.mockImplementation(() => {
        throw resolverError;
      });

      const modelFn = getModelFn();
      const thrown = await modelFn(makeModelFnArg()).catch((e: unknown) => e);

      expect(thrown).toBe(resolverError);
    });
  });

  describe('instructions', () => {
    it('uses SUMMARIZE_INSTRUCTIONS verbatim', () => {
      const config = getCapturedConfig();

      expect(config.instructions).toBe(SUMMARIZE_INSTRUCTIONS);
    });
  });

  describe('Mastra instance registration (additive change)', () => {
    it("is retrievable from the registry via getAgent('summarizeAgent')", async () => {
      const { mastra } = await import('../../index');

      expect(mastra.getAgent('summarizeAgent')).toBe(summarizeAgent);
    });

    it('keeps the existing growiAgent registered', async () => {
      const { mastra } = await import('../../index');
      const { growiAgent } = await import('../growi-agent');

      expect(mastra.getAgent('growiAgent')).toBe(growiAgent);
    });

    it('keeps the existing suggestPathAgent registered', async () => {
      const { mastra } = await import('../../index');
      const { suggestPathAgent } = await import('../suggest-path');

      expect(mastra.getAgent('suggestPathAgent')).toBe(suggestPathAgent);
    });
  });
});
