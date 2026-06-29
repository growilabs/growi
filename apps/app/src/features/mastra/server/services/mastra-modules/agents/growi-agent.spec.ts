import type { MastraModelConfig } from '@mastra/core/llm';
import type { RequestContext } from '@mastra/core/request-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MastraRequestContextShape } from '../types/request-context';

// Mock heavy collaborators that the agent module pulls in transitively.
//
// Mastra's `@mastra/core/agent` Agent class triggers a chain of internal
// chunks that import `pMapSkip` from `p-map`. The monorepo pins `p-map@4`
// for Mastra (CommonJS compatibility; see pnpm.overrides in root package.json
// — `"@mastra/core>p-map": "4.0.0"`). v4 has no `pMapSkip` named export, so
// ESM-style import under the unit-test workspace fails at module load.
//
// We don't need a real Agent for shape-checking — we only need to capture the
// constructor configuration that growi-agent.ts hands in. A stub Agent that
// stores the config and exposes it via the same listTools/getInstructions
// surface gives us exactly that, without booting Mastra's runtime.
interface CapturedAgentConfig {
  id?: string;
  name?: string;
  instructions: unknown;
  tools: Record<string, unknown>;
  model?: unknown;
  memory?: unknown;
}

vi.mock('@mastra/core/agent', () => {
  class StubAgent {
    name: string;
    private __config: CapturedAgentConfig;
    constructor(config: CapturedAgentConfig) {
      this.name = config.name ?? config.id ?? 'stub-agent';
      this.__config = config;
    }
    // Mirror the public surface used by callers.
    getInstructions(): unknown {
      return this.__config.instructions;
    }
    listTools(): Record<string, unknown> {
      return this.__config.tools;
    }
    // Test-only accessor: expose the raw constructor config so the spec can
    // read the `model` dynamic function that growi-agent.ts supplied.
    getCapturedConfig(): CapturedAgentConfig {
      return this.__config;
    }
  }
  return { Agent: StubAgent };
});

// Suppress logger noise from any transitively-imported logger consumers.
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

// Replace memory with an inert stub so we don't spin up MongoDBStore.
vi.mock('../memory', () => ({
  memory: { id: 'stub-memory' },
}));

// The resolver is the single seam this module depends on for model supply.
// A hoisted mutable holder lets each test choose the resolution that
// `resolveMastraModel(modelId?)` returns, while the mock itself stays declared
// once. The mock mirrors the real signature (`modelId?: string`) so the spec
// can assert which model id the agent forwarded.
// Because growi-agent.ts resolves the model lazily inside its `model()`
// function (not at import time), changing this return value between tests is
// enough to vary behavior — no module reset / re-import is required (and
// re-importing would re-register transitive Mongoose models and throw).
const resolverMock = vi.hoisted(() => ({
  fn: vi.fn<(modelId?: string) => MastraModelConfig>(),
}));

vi.mock('../../ai-sdk-modules/resolve-mastra-model', () => ({
  resolveMastraModel: (modelId?: string) => resolverMock.fn(modelId),
}));

// A sentinel model. The agent must hand back exactly this object from its
// `model()` function when resolution succeeds — proving it forwards the
// resolver's model rather than constructing one itself.
const sentinelModel = { id: 'sentinel-model' } as unknown as MastraModelConfig;

// Importing growiAgent is the act under test for Req 4.3: module load (and thus
// `new Agent(...)`) must complete WITHOUT calling the resolver. We import while
// the resolver is in a throwing (misconfigured) state and assert below that it
// was never invoked during construction — if it were, the import would throw.
resolverMock.fn.mockImplementation(() => {
  throw new Error('Mastra LLM provider is not configured (set AI_PROVIDER)');
});

import { growiAgent } from './growi-agent';

// Snapshot whether the resolver was touched during the import above.
const resolverCalledDuringImport = resolverMock.fn.mock.calls.length > 0;

// The dynamic model function Mastra invokes per request. It receives the
// request-scoped `{ requestContext }` and returns the resolved model.
type ModelFnArg = { requestContext: RequestContext<MastraRequestContextShape> };
type ModelFn = (arg: ModelFnArg) => MastraModelConfig;

// Narrow the captured config's `model` to the dynamic function without an
// assertion of its return value — only the callable shape is asserted.
const getModelFn = (): ModelFn => {
  const config =
    'getCapturedConfig' in growiAgent &&
    typeof growiAgent.getCapturedConfig === 'function'
      ? growiAgent.getCapturedConfig()
      : undefined;
  const model = config?.model;
  if (typeof model !== 'function') {
    throw new Error('Expected the agent model to be a dynamic function');
  }
  return model as ModelFn;
};

// Build the `{ requestContext }` argument the agent's model function expects,
// with `requestContext.get('modelId')` returning the supplied value. A typed
// stub (no `as any`) keeps the fake aligned with RequestContext's surface; only
// `get` is exercised by the model function.
const makeModelFnArg = (modelId?: string): ModelFnArg => {
  const requestContext = {
    get: (key: string): unknown => (key === 'modelId' ? modelId : undefined),
  } as unknown as RequestContext<MastraRequestContextShape>;
  return { requestContext };
};

describe('growiAgent', () => {
  beforeEach(() => {
    resolverMock.fn.mockReset();
  });

  describe('construction (requirement 4.3 — import never throws)', () => {
    it('constructs without invoking the resolver, so a disabled config cannot throw at import', () => {
      // The module was imported (top of file) while the resolver reported
      // disabled. Because model supply is a deferred dynamic function, the
      // import must have succeeded AND never called the resolver (Req 4.3).
      expect(growiAgent).toBeDefined();
      expect(resolverCalledDuringImport).toBe(false);
    });
  });

  describe('model supply (requirements 3.3, 5.1)', () => {
    it('returns the resolved model when resolution succeeds', () => {
      resolverMock.fn.mockReturnValue(sentinelModel);

      const modelFn = getModelFn();

      // The dynamic function forwards exactly the resolver's model (Req 3.3,
      // 5.1) — a single provider's single model, resolved at use time.
      expect(modelFn(makeModelFnArg())).toBe(sentinelModel);
    });
  });

  describe('per-request model selection (requirements 4.1, 4.3)', () => {
    it('forwards the requestContext modelId to the resolver', () => {
      resolverMock.fn.mockReturnValue(sentinelModel);

      const modelFn = getModelFn();
      modelFn(makeModelFnArg('gpt-4o-mini'));

      // The observable contract: the model id selected for this request
      // (carried on requestContext) is the id the resolver is asked to
      // resolve — so a per-request selection actually reaches model
      // resolution (Req 4.1).
      expect(resolverMock.fn).toHaveBeenCalledWith('gpt-4o-mini');
    });

    it('passes undefined to the resolver when no modelId is set, so the default is used', () => {
      resolverMock.fn.mockReturnValue(sentinelModel);

      const modelFn = getModelFn();
      modelFn(makeModelFnArg());

      // When the request carries no modelId the resolver is invoked with
      // undefined, which it resolves to the configured default (Req 4.3).
      expect(resolverMock.fn).toHaveBeenCalledWith(undefined);
    });
  });

  describe('model supply on misconfiguration (requirement 4.1, 4.3 — throw surfaces at use time)', () => {
    it('propagates the resolver throw at use time without swallowing it', () => {
      // On misconfiguration resolveMastraModel() throws; the agent's lazy
      // `model()` must let it surface (handled by the post-message route's
      // try/catch — Req 4.4), not swallow or replace it.
      const resolverError = new Error(
        'Mastra LLM API key is not configured for provider "openai" (set AI_API_KEY)',
      );
      resolverMock.fn.mockImplementation(() => {
        throw resolverError;
      });

      const modelFn = getModelFn();

      // Calling the dynamic function in a misconfigured state throws (Req 4.1).
      let thrown: unknown;
      try {
        modelFn(makeModelFnArg());
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBe(resolverError);
      // Defense-in-depth: the surfaced message carries no secret material.
      const message = thrown instanceof Error ? thrown.message : '';
      expect(message.toLowerCase()).not.toContain('sk-');
    });
  });

  describe('tools registration (requirements 4.1, 6.1)', () => {
    it('exposes fullTextSearchTool and getPageContentTool, and does NOT expose fileSearchTool', async () => {
      // listTools() may be sync (static config) or async (dynamic config).
      // `await` handles both shapes without committing to either.
      const tools = await growiAgent.listTools();
      const toolKeys = Object.keys(tools);

      expect(toolKeys).toContain('fullTextSearchTool');
      expect(toolKeys).toContain('getPageContentTool');
      expect(toolKeys).not.toContain('fileSearchTool');
    });
  });

  describe('instructions content (requirement 4.1, FB Issue 2 regression guard)', () => {
    // Type guard that narrows an unknown value to { content: unknown } without
    // a cast. Used in place of `(msg as { content: unknown }).content` inside
    // the .map below — once this guard returns true, TypeScript narrows the
    // variable's static type.
    const hasContentField = (v: unknown): v is { content: unknown } =>
      v != null && typeof v === 'object' && 'content' in v;

    const getInstructionsString = async (): Promise<string> => {
      const instructions = await growiAgent.getInstructions();
      // The agent declares instructions as a plain string. Defensive guard:
      // if the field is wrapped in an array of messages, flatten to text.
      if (typeof instructions === 'string') return instructions;
      if (Array.isArray(instructions)) {
        return instructions
          .map((msg: unknown) => {
            if (typeof msg === 'string') return msg;
            if (hasContentField(msg)) {
              const content = msg.content;
              return typeof content === 'string' ? content : '';
            }
            return '';
          })
          .join('\n');
      }
      return '';
    };

    it('is a non-empty string', async () => {
      const instructions = await growiAgent.getInstructions();
      // typeof check narrows `instructions` to `string` for the next line,
      // so no `as string` cast is needed. The expect on typeof gates the
      // .length read behind the narrowing.
      expect(typeof instructions).toBe('string');
      if (typeof instructions !== 'string') return;
      expect(instructions.length).toBeGreaterThan(0);
    });

    // Substring-presence assertions on instruction wording (cite-path order,
    // query operator list, outline/offset/hasMore drill-down) were removed
    // intentionally: they made every prompt iteration a test-maintenance
    // chore without catching real defects. Instruction phrasing is verified
    // by exercising the agent end-to-end, not by string-matching here.

    it('contains NO uncommented "Use the fileSearch tool" line (FB Issue 2)', async () => {
      const instructions = await getInstructionsString();

      // Split, trim, then identify any line that — after stripping a leading
      // `-` bullet marker — begins with "Use the fileSearch tool" AND is NOT
      // commented out via `//` or `<!--`. The fileSearch tool has been removed
      // from the agent, so no such line should exist; an uncommented variant is
      // the regression we guard against.
      const lines = instructions.split('\n').map((l) => l.trim());

      const uncommentedFileSearchLines = lines.filter((line) => {
        // Treat a line as commented out if it begins with `//` or `<!--`.
        if (line.startsWith('//')) return false;
        if (line.startsWith('<!--')) return false;

        // Strip a leading bullet marker so "- Use the fileSearch ..." also
        // matches. The presence of the substring at the start (after the
        // bullet) is what we forbid.
        const withoutBullet = line.replace(/^-\s*/, '');
        return withoutBullet.startsWith('Use the fileSearch tool');
      });

      expect(uncommentedFileSearchLines).toHaveLength(0);
    });
  });
});
