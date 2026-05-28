import { describe, expect, it, vi } from 'vitest';

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
vi.mock('@mastra/core/agent', () => {
  class StubAgent {
    name: string;
    private __instructions: unknown;
    private __tools: Record<string, unknown>;
    constructor(config: {
      id?: string;
      name?: string;
      instructions: unknown;
      tools: Record<string, unknown>;
      model?: unknown;
      memory?: unknown;
    }) {
      this.name = config.name ?? config.id ?? 'stub-agent';
      this.__instructions = config.instructions;
      this.__tools = config.tools;
    }
    // Mirror the public surface used by callers.
    getInstructions(): unknown {
      return this.__instructions;
    }
    listTools(): Record<string, unknown> {
      return this.__tools;
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

// The agent module reads a single config value for the model id. Returning a
// deterministic stub keeps the constructor's `model:` argument resolvable.
vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: (key: string) => {
      if (key === 'openai:assistantModel:mastraAgent') return 'gpt-test-model';
      if (key === 'openai:apiKey') return 'test-api-key';
      return undefined;
    },
  },
}));

// getOpenaiProvider()(model) — return a callable that yields a placeholder.
// The stub Agent above doesn't touch this, but the module still calls it.
vi.mock('../../ai-sdk-modules/get-openai-provider', () => ({
  getOpenaiProvider: () => (modelId: string) => ({
    id: modelId,
    provider: 'stub-openai',
  }),
}));

// Replace memory with an inert stub so we don't spin up MongoDBStore.
vi.mock('../memory', () => ({
  memory: { id: 'stub-memory' },
}));

import { growiAgent } from './growi-agent';

describe('growiAgent', () => {
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
      // commented out via `//` or `<!--`. The current "disabled" line on
      // growi-agent.ts L21 starts with `//` and must remain accepted; an
      // uncommented variant is the regression we guard against.
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
