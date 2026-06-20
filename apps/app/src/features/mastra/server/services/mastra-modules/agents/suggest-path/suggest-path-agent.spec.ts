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

// Config stub with a mutable backing map: the dynamic-model tests change a
// value BETWEEN model evaluations to prove per-request resolution (3.4).
const configMocks = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    getConfig: vi.fn((key: string) => values.get(key)),
  };
});

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: configMocks.getConfig },
}));

// getOpenaiProvider()(modelId) — return a callable provider that yields a
// placeholder carrying the resolved model id, so tests can observe which id
// the dynamic model function resolved.
vi.mock('../../../ai-sdk-modules/get-openai-provider', () => ({
  getOpenaiProvider: () => (modelId: string) => ({
    id: modelId,
    provider: 'stub-openai',
  }),
}));

// Replace memory with an inert stub: mastra-modules/index.ts (loaded by the
// registration tests) pulls in growi-agent.ts -> ../memory, which would spin
// up MongoDBStore at module load.
vi.mock('../../memory', () => ({
  memory: { id: 'stub-memory' },
}));

import { getPageContentTool } from '../../tools/get-page-content-tool';
import { listChildrenTool } from '../../tools/list-children-tool';
import { SUGGEST_PATH_INSTRUCTIONS } from './instructions';
import { limitedSearchTool } from './limited-search-tool';
import { suggestPathAgent } from './suggest-path-agent';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MODEL_CONFIG_KEY = 'openai:assistantModel:suggestPathAgent';

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
  configMocks.values.clear();
  configMocks.values.set(MODEL_CONFIG_KEY, 'gpt-test-model');
  configMocks.getConfig.mockClear();
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

    it("resolves the model id via configManager key 'openai:assistantModel:suggestPathAgent'", () => {
      const resolved = resolveModel(getCapturedConfig());

      expect(configMocks.getConfig).toHaveBeenCalledWith(MODEL_CONFIG_KEY);
      expect(resolved).toMatchObject({
        id: 'gpt-test-model',
        provider: 'stub-openai',
      });
    });

    it('re-resolves the model on every evaluation, so a config change takes effect without a restart', () => {
      const config = getCapturedConfig();

      configMocks.values.set(MODEL_CONFIG_KEY, 'gpt-first');
      expect(resolveModel(config)).toMatchObject({ id: 'gpt-first' });

      configMocks.values.set(MODEL_CONFIG_KEY, 'gpt-second');
      expect(resolveModel(config)).toMatchObject({ id: 'gpt-second' });
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
