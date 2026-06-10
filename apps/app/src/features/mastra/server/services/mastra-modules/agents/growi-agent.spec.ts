import type { MastraModelConfig } from '@mastra/core/llm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MastraModelResolution } from '../../ai-sdk-modules/resolve-mastra-model';

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
// `resolveMastraModel()` returns, while the mock itself stays declared once.
// Because growi-agent.ts resolves the model lazily inside its `model()`
// function (not at import time), changing this return value between tests is
// enough to vary behavior — no module reset / re-import is required (and
// re-importing would re-register transitive Mongoose models and throw).
const resolverMock = vi.hoisted(() => ({
  fn: vi.fn<() => MastraModelResolution>(),
}));

vi.mock('../../ai-sdk-modules/resolve-mastra-model', () => ({
  resolveMastraModel: () => resolverMock.fn(),
}));

// A sentinel model. The agent must hand back exactly this object from its
// `model()` function when resolution is ok — proving it forwards the resolver's
// model rather than constructing one itself.
const sentinelModel = { id: 'sentinel-model' } as unknown as MastraModelConfig;

// Importing growiAgent is the act under test for Req 4.3: module load (and
// thus `new Agent(...)`) must complete WITHOUT calling the resolver. We import
// while the resolver is in a disabled state and assert below that it was never
// invoked during construction.
resolverMock.fn.mockReturnValue({
  status: 'disabled',
  reason: { type: 'vendor-unset' },
});

import { growiAgent } from './growi-agent';

// Snapshot whether the resolver was touched during the import above.
const resolverCalledDuringImport = resolverMock.fn.mock.calls.length > 0;

// Narrow the captured config's `model` to a callable without an assertion.
const getModelFn = (): (() => MastraModelConfig) => {
  const config =
    'getCapturedConfig' in growiAgent &&
    typeof growiAgent.getCapturedConfig === 'function'
      ? growiAgent.getCapturedConfig()
      : undefined;
  const model = config?.model;
  if (typeof model !== 'function') {
    throw new Error('Expected the agent model to be a dynamic function');
  }
  return model as () => MastraModelConfig;
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
    it('returns the resolved model when resolution is ok', () => {
      resolverMock.fn.mockReturnValue({
        status: 'ok',
        vendor: 'openai',
        model: sentinelModel,
      });

      const modelFn = getModelFn();

      // The dynamic function forwards exactly the resolver's model (Req 3.3,
      // 5.1) — a single vendor's single model, resolved at use time.
      expect(modelFn()).toBe(sentinelModel);
    });
  });

  describe('model supply when disabled (requirement 4.1 — error carries reason, not secrets)', () => {
    it('throws carrying the reason type, never an apiKey, when resolution is disabled', () => {
      resolverMock.fn.mockReturnValue({
        status: 'disabled',
        reason: { type: 'api-key-missing', vendor: 'openai' },
      });

      const modelFn = getModelFn();

      // Calling the dynamic function in a disabled state throws (Req 4.1).
      let thrown: unknown;
      try {
        modelFn();
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(Error);
      const message = thrown instanceof Error ? thrown.message : '';

      // The reason type must be present so the cause is diagnosable...
      expect(message).toContain('api-key-missing');
      // ...but no secret material may leak into the thrown message (Req 4.1 /
      // 2.5 spirit). Guard against the actual key shape the resolver holds.
      expect(message).not.toContain('test-api-key');
      expect(message.toLowerCase()).not.toContain('apikey');
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
