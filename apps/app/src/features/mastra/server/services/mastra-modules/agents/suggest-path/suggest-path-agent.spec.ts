import type { MastraModelConfig } from '@mastra/core/llm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Shape of the Agent constructor configuration this spec asserts on. The
// constructor arguments ARE the contract between suggest-path-agent.ts and
// Mastra, so capturing them at the (un-importable) library boundary is the
// observable behavior here.
type CapturedAgentConfig = {
  id?: string;
  name?: string;
  instructions?: unknown;
  model?: unknown;
  tools?: Record<string, unknown>;
  memory?: unknown;
};

const captured = vi.hoisted(() => ({
  // Every Agent built in this module graph lands here (growiAgent is also
  // constructed when the registration tests load mastra-modules/index.ts),
  // so entries are looked up by id instead of assuming a single agent.
  agentConfigs: [] as CapturedAgentConfig[],
}));

// Mastra's `@mastra/core/agent` cannot be imported under vitest: the monorepo
// pins `p-map@4` for Mastra (pnpm override `@mastra/core>p-map: 4.0.0`) and
// v4 has no `pMapSkip` named export, so the ESM build fails at module link.
// The StubAgent pattern mirrors growi-agent.spec.ts: store the constructor
// config and assert on it.
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
// chunks affected by the p-map override). The registration contract under
// test is "the agents map handed to the constructor is retrievable via
// getAgent" — a boundary contract, not Mastra internals.
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
// `resolveMastraModel()` returns, while the mock itself stays declared once.
// Because suggest-path-agent.ts resolves the model lazily inside its `model()`
// function (not at import time), changing this return value between tests is
// enough to vary behavior — no module reset / re-import is required.
const resolverMock = vi.hoisted(() => ({
  fn: vi.fn<() => MastraModelConfig>(),
}));

vi.mock('../../../ai-sdk-modules/resolve-mastra-model', () => ({
  resolveMastraModel: () => resolverMock.fn(),
}));

// Replace memory with an inert stub: mastra-modules/index.ts (loaded by the
// registration tests) pulls in growi-agent.ts -> ../memory, which would spin
// up MongoDBStore at module load.
vi.mock('../../memory', () => ({
  memory: { id: 'stub-memory' },
}));

// A sentinel model. The agent must hand back exactly this object from its
// `model()` function when resolution succeeds — proving it forwards the
// resolver's model rather than constructing one itself.
const sentinelModel = { id: 'sentinel-model' } as unknown as MastraModelConfig;

// Importing suggestPathAgent is the act under test for lazy resolution: module
// load (and thus `new Agent(...)`) must complete WITHOUT calling the resolver.
// We import while the resolver is in a throwing (misconfigured) state and
// assert below that it was never invoked during construction — if it were, the
// import would throw.
resolverMock.fn.mockImplementation(() => {
  throw new Error('Mastra LLM provider is not configured (set AI_PROVIDER)');
});

import { getPageContentTool } from '../../tools/get-page-content-tool';
import { SUGGEST_PATH_INSTRUCTIONS } from './instructions';
import { limitedSearchTool } from './limited-search-tool';
import { listChildrenTool } from './list-children-tool';
import { suggestPathAgent } from './suggest-path-agent';

// Snapshot whether the resolver was touched during the import above.
const resolverCalledDuringImport = resolverMock.fn.mock.calls.length > 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getCapturedConfig = (): CapturedAgentConfig => {
  const config = captured.agentConfigs.find((c) => c.id === 'suggestPathAgent');
  if (config == null) {
    throw new Error('suggestPathAgent constructor config was not captured');
  }
  return config;
};

// Narrow `model` to a callable and evaluate it once. Throwing (instead of a
// non-null assertion) keeps every call site cast-free.
const resolveModel = (config: CapturedAgentConfig): unknown => {
  const { model } = config;
  if (typeof model !== 'function') {
    throw new Error('model is expected to be a DynamicArgument function');
  }
  return model();
};

beforeEach(() => {
  resolverMock.fn.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('suggestPathAgent', () => {
  describe('agent identity', () => {
    it("is constructed with id 'suggestPathAgent' (the registry retrieval key) and a display name", () => {
      const config = getCapturedConfig();

      expect(config.id).toBe('suggestPathAgent');
      expect(config.name).toBe('Suggest Path Agent');
    });
  });

  describe('tools composition (Requirements 1.1, 1.2, 1.3)', () => {
    it('wires fullTextSearch to the budget-enforcing limitedSearchTool by reference', () => {
      const config = getCapturedConfig();

      expect(config.tools?.fullTextSearch).toBe(limitedSearchTool);
    });

    it('wires getPageContent to the shared getPageContentTool by reference', () => {
      const config = getCapturedConfig();

      expect(config.tools?.getPageContent).toBe(getPageContentTool);
    });

    it('wires listChildren to the shared listChildrenTool by reference', () => {
      const config = getCapturedConfig();

      expect(config.tools?.listChildren).toBe(listChildrenTool);
    });

    it('exposes exactly the three exploration tools', () => {
      const config = getCapturedConfig();

      expect(Object.keys(config.tools ?? {}).sort()).toEqual([
        'fullTextSearch',
        'getPageContent',
        'listChildren',
      ]);
    });
  });

  describe('memory (stateless agent)', () => {
    it('does not connect memory', () => {
      const config = getCapturedConfig();

      expect(config.memory).toBeUndefined();
    });
  });

  describe('dynamic model (Requirement 3.4)', () => {
    it('passes model as a function (DynamicArgument), not a static model instance', () => {
      const config = getCapturedConfig();

      expect(typeof config.model).toBe('function');
    });

    it('constructs without invoking the resolver, so a disabled config cannot throw at import', () => {
      // The module was imported (top of file) while the resolver reported
      // disabled. Because model supply is a deferred dynamic function, the
      // import must have succeeded AND never called the resolver.
      expect(suggestPathAgent).toBeDefined();
      expect(resolverCalledDuringImport).toBe(false);
    });

    it('forwards the model from resolveMastraModel() when resolution succeeds', () => {
      resolverMock.fn.mockReturnValue(sentinelModel);

      // The dynamic function hands back exactly the resolver's model — a single
      // provider's single model (support/mastra's provider-agnostic AI layer),
      // resolved at use time rather than constructed here.
      expect(resolveModel(getCapturedConfig())).toBe(sentinelModel);
    });

    it('re-resolves the model on every evaluation, so a config change takes effect without a restart', () => {
      const config = getCapturedConfig();

      const firstModel = { id: 'model-first' } as unknown as MastraModelConfig;
      const secondModel = {
        id: 'model-second',
      } as unknown as MastraModelConfig;

      resolverMock.fn.mockReturnValue(firstModel);
      expect(resolveModel(config)).toBe(firstModel);

      resolverMock.fn.mockReturnValue(secondModel);
      expect(resolveModel(config)).toBe(secondModel);
    });

    it('propagates the resolver throw at use time without swallowing it', () => {
      // On misconfiguration resolveMastraModel() throws; the agent's lazy
      // model() must let it surface (handled by the engine's error handling),
      // not swallow or replace it.
      const resolverError = new Error(
        'Mastra LLM provider is not configured (set AI_PROVIDER)',
      );
      resolverMock.fn.mockImplementation(() => {
        throw resolverError;
      });

      let thrown: unknown;
      try {
        resolveModel(getCapturedConfig());
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBe(resolverError);
    });
  });

  describe('instructions (Requirements 2.1, 2.2)', () => {
    it('uses SUGGEST_PATH_INSTRUCTIONS verbatim', () => {
      const config = getCapturedConfig();

      expect(config.instructions).toBe(SUGGEST_PATH_INSTRUCTIONS);
    });
  });

  describe('Mastra instance registration', () => {
    it("is retrievable from the registry via getAgent('suggestPathAgent')", async () => {
      const { mastra } = await import('../../index');

      expect(mastra.getAgent('suggestPathAgent')).toBe(suggestPathAgent);
    });

    it('keeps the existing growiAgent registered (additive change)', async () => {
      const { mastra } = await import('../../index');
      const { growiAgent } = await import('../growi-agent');

      expect(mastra.getAgent('growiAgent')).toBe(growiAgent);
    });
  });
});
