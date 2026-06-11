import type { IUserHasId } from '@growi/core/dist/interfaces';
import type { RequestContext } from '@mastra/core/request-context';
import { mock } from 'vitest-mock-extended';

import type { SuggestPathRequestContextShape } from '~/features/mastra/server/services/mastra-modules/agents/suggest-path';
import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';

import type { SearchService } from '../../../interfaces/suggest-path-types';
import { AGENTIC_OUTPUT_JSON_SCHEMA } from './agentic-output-schema';

const mocks = vi.hoisted(() => {
  const configValues = new Map<string, unknown>();
  return {
    configValues,
    getConfigMock: vi.fn((key: string) => configValues.get(key)),
    generateMock: vi.fn(),
    getAgentMock: vi.fn(),
    resolveParentGrantMock: vi.fn(),
  };
});

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: mocks.getConfigMock },
}));

// The real mastra-modules barrel transitively imports `@mastra/core/agent`,
// which cannot be loaded under vitest (the pnpm override `@mastra/core>p-map:
// 4.0.0` breaks Mastra's ESM build — research.md "Spike Results"). The
// registry is therefore stubbed at this module boundary; the contract under
// test is "the engine retrieves the agent by id from the registry and drives
// generate with the documented options".
vi.mock('~/features/mastra/server/services/mastra-modules', () => ({
  mastra: { getAgent: mocks.getAgentMock },
}));

vi.mock('../resolve-parent-grant', () => ({
  resolveParentGrant: mocks.resolveParentGrantMock,
}));

import { agenticEngine } from './agentic-engine';

const SEARCH_LIMIT_KEY = 'aiTools:suggestPathAgenticSearchLimit';
const TIMEOUT_KEY = 'aiTools:suggestPathAgenticTimeoutMs';

const mockUser = mock<IUserHasId>({ username: 'alice' });
const mockUserGroups: ObjectIdLike[] = ['group1'];
const mockSearchService = mock<SearchService>();

// Shape of the options object the engine passes to agent.generate — the
// contract pinned by design.md ("AgenticEngine" agent call contract).
type CapturedGenerateOptions = {
  structuredOutput: { schema: unknown };
  maxSteps: number;
  abortSignal: AbortSignal;
  requestContext: RequestContext<SuggestPathRequestContextShape>;
};

const getGenerateCall = (
  callIndex = 0,
): { prompt: string; options: CapturedGenerateOptions } => {
  const call = mocks.generateMock.mock.calls[callIndex];
  if (call == null) {
    throw new Error(`generate was not called ${callIndex + 1} time(s)`);
  }
  const [prompt, options] = call;
  return { prompt, options };
};

const suggestionEntry = (
  path: string,
  n: number,
): { path: string; label: string; description: string } => ({
  path,
  label: `label-${n}`,
  description: `description-${n}`,
});

const outputWith = (
  suggestions: ReadonlyArray<{
    path: string;
    label: string;
    description: string;
  }>,
  informationType: 'flow' | 'stock' = 'stock',
): unknown => ({ informationType, suggestions });

const primeGenerate = (object: unknown): void => {
  mocks.generateMock.mockResolvedValue({ object });
};

// Simulates Mastra's abortSignal handling: generate stays pending until the
// signal aborts, then rejects with the abort reason.
const armAbortAwareGenerate = (): void => {
  mocks.generateMock.mockImplementation(
    (_messages: unknown, options: CapturedGenerateOptions) =>
      new Promise((_resolve, reject) => {
        options.abortSignal.addEventListener('abort', () => {
          reject(options.abortSignal.reason);
        });
      }),
  );
};

const callEngine = (): ReturnType<typeof agenticEngine> =>
  agenticEngine({
    user: mockUser,
    body: 'Some document content',
    userGroups: mockUserGroups,
    searchService: mockSearchService,
  });

beforeEach(() => {
  mocks.configValues.clear();
  mocks.configValues.set(SEARCH_LIMIT_KEY, 5);
  mocks.configValues.set(TIMEOUT_KEY, 60_000);
  mocks.getConfigMock.mockClear();
  mocks.generateMock.mockReset();
  mocks.getAgentMock.mockReset();
  mocks.getAgentMock.mockReturnValue({ generate: mocks.generateMock });
  mocks.resolveParentGrantMock.mockReset();
  mocks.resolveParentGrantMock.mockResolvedValue(1);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('agenticEngine', () => {
  describe('agent invocation contract', () => {
    it('retrieves the agent from the Mastra registry by id', async () => {
      primeGenerate(outputWith([]));

      await callEngine();

      expect(mocks.getAgentMock).toHaveBeenCalledWith('suggestPathAgent');
    });

    it('passes the structured output schema constant, derived maxSteps, and an abort signal to generate', async () => {
      primeGenerate(outputWith([]));

      await callEngine();

      const { options } = getGenerateCall();
      expect(options.structuredOutput.schema).toBe(AGENTIC_OUTPUT_JSON_SCHEMA);
      expect(options.maxSteps).toBe(14); // 2 * searchLimit(5) + 4
      expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    });

    it('embeds the document body in the prompt', async () => {
      primeGenerate(outputWith([]));

      await callEngine();

      expect(getGenerateCall().prompt).toContain('Some document content');
    });

    it('propagates the requesting user and search service through the request context', async () => {
      primeGenerate(outputWith([]));

      await callEngine();

      const ctx = getGenerateCall().options.requestContext;
      expect(ctx.get('user')).toBe(mockUser);
      expect(ctx.get('searchService')).toBe(mockSearchService);
    });
  });

  describe('output mapping', () => {
    it('maps suggestions to search-type PathSuggestions with per-path grant and informationType', async () => {
      primeGenerate({
        informationType: 'stock',
        suggestions: [
          {
            path: '/tech/React/',
            label: 'Save under React docs',
            description: 'Existing React documentation tree',
          },
          {
            path: '/tech/React/hooks/',
            label: 'Hooks section',
            description: 'Sibling pages cover hooks topics',
          },
        ],
      });
      mocks.resolveParentGrantMock
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(4);

      const result = await callEngine();

      expect(result).toEqual([
        {
          type: 'search',
          path: '/tech/React/',
          label: 'Save under React docs',
          description: 'Existing React documentation tree',
          grant: 1,
          informationType: 'stock',
        },
        {
          type: 'search',
          path: '/tech/React/hooks/',
          label: 'Hooks section',
          description: 'Sibling pages cover hooks topics',
          grant: 4,
          informationType: 'stock',
        },
      ]);
    });

    it('normalizes paths to leading/trailing-slash form and resolves grants against the normalized paths', async () => {
      primeGenerate(
        outputWith([
          suggestionEntry('tech/React', 1),
          suggestionEntry('/docs/api', 2),
          suggestionEntry('notes/', 3),
        ]),
      );

      const result = await callEngine();

      expect(result.map((s) => s.path)).toEqual([
        '/tech/React/',
        '/docs/api/',
        '/notes/',
      ]);
      expect(mocks.resolveParentGrantMock).toHaveBeenCalledWith('/tech/React/');
      expect(mocks.resolveParentGrantMock).toHaveBeenCalledWith('/docs/api/');
      expect(mocks.resolveParentGrantMock).toHaveBeenCalledWith('/notes/');
    });

    it('discards entries whose path cannot be normalized (empty or whitespace-only)', async () => {
      primeGenerate(
        outputWith([
          suggestionEntry('', 1),
          suggestionEntry('   ', 2),
          suggestionEntry('/valid/', 3),
        ]),
      );

      const result = await callEngine();

      expect(result.map((s) => s.path)).toEqual(['/valid/']);
      expect(mocks.resolveParentGrantMock).toHaveBeenCalledTimes(1);
    });

    it('returns an empty array when every entry is discarded by normalization', async () => {
      primeGenerate(outputWith([suggestionEntry('', 1)]));

      const result = await callEngine();

      expect(result).toEqual([]);
      expect(mocks.resolveParentGrantMock).not.toHaveBeenCalled();
    });

    it('de-duplicates paths that normalize to the same directory, keeping the first entry', async () => {
      primeGenerate(
        outputWith([
          {
            path: '/tech/',
            label: 'first label',
            description: 'first description',
          },
          { path: 'tech', label: 'dup label 1', description: 'dup 1' },
          { path: 'tech/', label: 'dup label 2', description: 'dup 2' },
        ]),
      );

      const result = await callEngine();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        path: '/tech/',
        label: 'first label',
        description: 'first description',
      });
    });

    it('caps the result at 3 suggestions even when the model ignores maxItems', async () => {
      primeGenerate(
        outputWith([
          suggestionEntry('/a/', 1),
          suggestionEntry('/b/', 2),
          suggestionEntry('/c/', 3),
          suggestionEntry('/d/', 4),
          suggestionEntry('/e/', 5),
        ]),
      );

      const result = await callEngine();

      expect(result.map((s) => s.path)).toEqual(['/a/', '/b/', '/c/']);
      expect(mocks.resolveParentGrantMock).toHaveBeenCalledTimes(3);
    });

    it('applies the top-level flow informationType to every suggestion', async () => {
      primeGenerate(
        outputWith(
          [suggestionEntry('/diary/', 1), suggestionEntry('/logs/', 2)],
          'flow',
        ),
      );

      const result = await callEngine();

      expect(result).toHaveLength(2);
      for (const suggestion of result) {
        expect(suggestion.informationType).toBe('flow');
        expect(suggestion.type).toBe('search');
      }
    });

    it('returns an empty array when the agent proposes no suggestions', async () => {
      primeGenerate(outputWith([]));

      const result = await callEngine();

      expect(result).toEqual([]);
    });
  });

  describe('invalid output', () => {
    it('rejects when the structured output fails the type guard', async () => {
      primeGenerate({ informationType: 'neither', suggestions: [] });

      await expect(callEngine()).rejects.toThrow(/validation/);
    });

    it('rejects when the structured output is missing', async () => {
      primeGenerate(undefined);

      await expect(callEngine()).rejects.toThrow(/validation/);
    });
  });

  describe('failure propagation', () => {
    it('rejects when generate itself rejects (agent / provider failure)', async () => {
      mocks.generateMock.mockRejectedValue(
        new Error('provider initialization failed'),
      );

      await expect(callEngine()).rejects.toThrow(
        'provider initialization failed',
      );
    });

    it('rejects when grant resolution fails for any path', async () => {
      primeGenerate(
        outputWith([suggestionEntry('/a/', 1), suggestionEntry('/b/', 2)]),
      );
      mocks.resolveParentGrantMock.mockRejectedValueOnce(
        new Error('mongo down'),
      );

      await expect(callEngine()).rejects.toThrow('mongo down');
    });
  });

  describe('timeout', () => {
    it('aborts generate and rejects once the configured timeout elapses — and not before', async () => {
      vi.useFakeTimers();
      armAbortAwareGenerate();

      const enginePromise = callEngine();
      const rejection = expect(enginePromise).rejects.toThrow(
        'agentic engine timed out after 60000ms',
      );

      await vi.advanceTimersByTimeAsync(59_999);
      expect(getGenerateCall().options.abortSignal.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(getGenerateCall().options.abortSignal.aborted).toBe(true);

      await rejection;
    });

    it('leaves no armed timer behind after a successful run', async () => {
      vi.useFakeTimers();
      primeGenerate(outputWith([suggestionEntry('/a/', 1)]));

      await callEngine();

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('per-request config reads', () => {
    it('re-reads the search limit per request: maxSteps and budget limit follow a config change without restart', async () => {
      primeGenerate(outputWith([]));

      await callEngine();
      const first = getGenerateCall(0);
      expect(first.options.maxSteps).toBe(14); // 2 * 5 + 4
      expect(first.options.requestContext.get('searchBudget')).toEqual({
        limit: 5,
        used: 0,
        queries: [],
      });

      mocks.configValues.set(SEARCH_LIMIT_KEY, 3);

      await callEngine();
      const second = getGenerateCall(1);
      expect(second.options.maxSteps).toBe(10); // 2 * 3 + 4
      expect(second.options.requestContext.get('searchBudget')).toEqual({
        limit: 3,
        used: 0,
        queries: [],
      });
    });

    it('re-reads the timeout per request: the abort boundary follows a config change without restart', async () => {
      vi.useFakeTimers();
      armAbortAwareGenerate();
      mocks.configValues.set(TIMEOUT_KEY, 1000);

      const first = callEngine();
      const firstRejection = expect(first).rejects.toThrow(
        'timed out after 1000ms',
      );
      await vi.advanceTimersByTimeAsync(1000);
      await firstRejection;

      mocks.configValues.set(TIMEOUT_KEY, 5000);

      const second = callEngine();
      const secondRejection = expect(second).rejects.toThrow(
        'timed out after 5000ms',
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(getGenerateCall(1).options.abortSignal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(4000);
      expect(getGenerateCall(1).options.abortSignal.aborted).toBe(true);
      await secondRejection;
    });

    it('builds a fresh request context with a zeroed budget for every request (no module-scope sharing)', async () => {
      mocks.generateMock.mockImplementation(
        (_messages: unknown, options: CapturedGenerateOptions) => {
          // Simulate the agent loop consuming budget during the request —
          // the NEXT request must not observe this consumption.
          const budget = options.requestContext.get('searchBudget');
          budget.used += 2;
          budget.queries.push('consumed query');
          return Promise.resolve({ object: outputWith([]) });
        },
      );

      await callEngine();
      await callEngine();

      const firstCtx = getGenerateCall(0).options.requestContext;
      const secondCtx = getGenerateCall(1).options.requestContext;

      expect(secondCtx).not.toBe(firstCtx);
      expect(secondCtx.get('searchBudget')).not.toBe(
        firstCtx.get('searchBudget'),
      );
      // Each request started from used=0: had the budget been shared, the
      // second request would show the accumulated count (4) instead.
      expect(firstCtx.get('searchBudget').used).toBe(2);
      expect(secondCtx.get('searchBudget').used).toBe(2);
    });
  });
});
