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
    loggerInfoMock: vi.fn(),
    loggerDebugMock: vi.fn(),
    loggerWarnMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  };
});

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: mocks.getConfigMock },
}));

// The engine creates its logger at module scope via the factory default
// export; mocking the factory lets the tests assert the exploration trace
// contract (info summary + debug detail) per request (design.md
// "AgenticEngine > State Management").
vi.mock('~/utils/logger', () => ({
  default: vi.fn(() => ({
    info: mocks.loggerInfoMock,
    debug: mocks.loggerDebugMock,
    warn: mocks.loggerWarnMock,
    error: mocks.loggerErrorMock,
  })),
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
const CHILD_LISTING_LIMIT_KEY = 'aiTools:suggestPathAgenticChildListingLimit';
const TIMEOUT_KEY = 'aiTools:suggestPathAgenticTimeoutMs';
const REASONING_EFFORT_KEY = 'openai:reasoningEffort:suggestPathAgent';

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
  // Present only when a non-empty reasoning effort is configured; absent
  // otherwise so the model's default behavior is left unchanged.
  providerOptions?: { openai: { reasoningEffort: string } };
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

// Runtime chunk shapes of steps[].toolCalls / steps[].toolResults as observed
// on @mastra/core 1.41.0 (research.md "Spike Results" item 4).
const toolCallChunk = (toolName: string, args: unknown): unknown => ({
  type: 'tool-call',
  runId: 'run-1',
  from: 'AGENT',
  payload: { toolCallId: 'call-1', toolName, args },
});

const toolResultChunk = (toolName: string, result: unknown): unknown => ({
  type: 'tool-result',
  runId: 'run-1',
  from: 'AGENT',
  payload: { toolCallId: 'call-1', toolName, result },
});

// Primes generate with a runtime-shaped full result (steps / totalUsage) and
// simulates the agent loop consuming the search budget — the budget is the
// engine's primary source for searchCount and the executed-query sequence.
const primeGenerateWithExploration = (exploration: {
  object: unknown;
  queries?: readonly string[];
  steps?: unknown;
  totalUsage?: unknown;
}): void => {
  mocks.generateMock.mockImplementation(
    (_messages: unknown, options: CapturedGenerateOptions) => {
      const budget = options.requestContext.get('searchBudget');
      for (const query of exploration.queries ?? []) {
        budget.used += 1;
        budget.queries.push(query);
      }
      return Promise.resolve({
        object: exploration.object,
        steps: exploration.steps,
        totalUsage: exploration.totalUsage,
      });
    },
  );
};

// AI SDK v5 usage shape (research.md "Spike Results" item 4) — the engine
// must pick inputTokens / outputTokens / totalTokens and ignore the rest.
const SAMPLE_TOTAL_USAGE = {
  inputTokens: 1183,
  outputTokens: 232,
  totalTokens: 1415,
  reasoningTokens: 0,
  cachedInputTokens: 0,
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
  mocks.configValues.set(CHILD_LISTING_LIMIT_KEY, 5);
  mocks.configValues.set(TIMEOUT_KEY, 60_000);
  // Default to unset reasoning effort; the dedicated tests override this.
  mocks.configValues.set(REASONING_EFFORT_KEY, '');
  mocks.getConfigMock.mockClear();
  mocks.generateMock.mockReset();
  mocks.getAgentMock.mockReset();
  mocks.getAgentMock.mockReturnValue({ generate: mocks.generateMock });
  mocks.resolveParentGrantMock.mockReset();
  mocks.resolveParentGrantMock.mockResolvedValue(1);
  mocks.loggerInfoMock.mockClear();
  mocks.loggerDebugMock.mockClear();
  mocks.loggerWarnMock.mockClear();
  mocks.loggerErrorMock.mockClear();
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
      // 2 * searchLimit(5) + 2 * childListingLimit(5) + 4
      expect(options.maxSteps).toBe(24);
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

    it('caps the result at 20 suggestions even when the model ignores maxItems', async () => {
      primeGenerate(
        outputWith(
          Array.from({ length: 21 }, (_, i) =>
            suggestionEntry(`/p${i}/`, i + 1),
          ),
        ),
      );

      const result = await callEngine();

      expect(result.map((s) => s.path)).toEqual(
        Array.from({ length: 20 }, (_, i) => `/p${i}/`),
      );
      expect(mocks.resolveParentGrantMock).toHaveBeenCalledTimes(20);
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
      expect(first.options.maxSteps).toBe(24); // 2 * 5 + 2 * 5 + 4
      expect(first.options.requestContext.get('searchBudget')).toEqual({
        limit: 5,
        used: 0,
        queries: [],
      });

      mocks.configValues.set(SEARCH_LIMIT_KEY, 3);

      await callEngine();
      const second = getGenerateCall(1);
      expect(second.options.maxSteps).toBe(20); // 2 * 3 + 2 * 5 + 4
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

    it('forwards a configured reasoning effort to the provider via providerOptions', async () => {
      primeGenerate(outputWith([]));
      mocks.configValues.set(REASONING_EFFORT_KEY, 'minimal');

      await callEngine();

      expect(getGenerateCall(0).options.providerOptions).toEqual({
        openai: { reasoningEffort: 'minimal' },
      });
    });

    it('omits providerOptions when the reasoning effort is unset (empty), leaving the model default unchanged', async () => {
      primeGenerate(outputWith([]));
      // beforeEach already sets the key to '' (unset); assert the engine
      // passes no providerOptions so the provider applies its own default.

      await callEngine();

      expect(getGenerateCall(0).options.providerOptions).toBeUndefined();
    });

    it('re-reads the reasoning effort per request: a config change is reflected without restart', async () => {
      primeGenerate(outputWith([]));

      await callEngine();
      expect(getGenerateCall(0).options.providerOptions).toBeUndefined();

      mocks.configValues.set(REASONING_EFFORT_KEY, 'low');

      await callEngine();
      expect(getGenerateCall(1).options.providerOptions).toEqual({
        openai: { reasoningEffort: 'low' },
      });
    });

    it('builds a fresh request context with a zeroed budget for every request (no module-scope sharing)', async () => {
      mocks.generateMock.mockImplementation(
        (_messages: unknown, options: CapturedGenerateOptions) => {
          // Simulate the agent loop consuming both budgets during the request
          // — the NEXT request must not observe this consumption.
          const budget = options.requestContext.get('searchBudget');
          budget.used += 2;
          budget.queries.push('consumed query');
          const childBudget = options.requestContext.get('childListingBudget');
          childBudget.used += 1;
          childBudget.paths.push('/consumed/path/');
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
      expect(secondCtx.get('childListingBudget')).not.toBe(
        firstCtx.get('childListingBudget'),
      );
      // Each request started from used=0: had a budget been shared, the second
      // request would show the accumulated count instead.
      expect(firstCtx.get('searchBudget').used).toBe(2);
      expect(secondCtx.get('searchBudget').used).toBe(2);
      expect(firstCtx.get('childListingBudget').used).toBe(1);
      expect(secondCtx.get('childListingBudget').used).toBe(1);
    });
  });

  describe('exploration trace logging', () => {
    const getInfoSummary = (): unknown => {
      const call = mocks.loggerInfoMock.mock.calls[0];
      if (call == null) {
        throw new Error('logger.info was not called');
      }
      return call[0];
    };

    it('emits exactly one info summary containing all 8 contract fields — and nothing else — on success', async () => {
      primeGenerateWithExploration({
        object: outputWith([
          suggestionEntry('/tech/', 1),
          suggestionEntry('/notes/', 2),
        ]),
        queries: ['react hooks', 'react documentation'],
        steps: [
          {
            toolCalls: [
              toolCallChunk('fullTextSearch', { query: 'react hooks' }),
              toolCallChunk('fullTextSearch', { query: 'react documentation' }),
            ],
            toolResults: [
              toolResultChunk('fullTextSearch', {
                result: 'ok',
                hits: [{ pageId: 'p1', pagePath: '/tech/hit' }],
                totalCount: 1,
              }),
            ],
          },
          {
            toolCalls: [toolCallChunk('getPageContent', { pageId: 'p1' })],
            toolResults: [
              toolResultChunk('getPageContent', { body: 'page body text' }),
            ],
          },
        ],
        totalUsage: SAMPLE_TOTAL_USAGE,
      });

      await callEngine();

      expect(mocks.loggerInfoMock).toHaveBeenCalledTimes(1);
      // Exact shape: the summary line is an operational contract (the
      // #183968 evaluator parses it) — extra fields would also risk
      // leaking body-derived strings into info.
      expect(getInfoSummary()).toEqual({
        durationMs: expect.any(Number),
        searchCount: 2,
        listChildrenCount: 0,
        pageReadCount: 1,
        stopReason: 'completed',
        informationType: 'stock',
        suggestionCount: 2,
        tokenUsage: { inputTokens: 1183, outputTokens: 232, totalTokens: 1415 },
      });
    });

    it('reports stopReason "budget_exhausted" when the run completes with the budget fully used', async () => {
      mocks.configValues.set(SEARCH_LIMIT_KEY, 2);
      primeGenerateWithExploration({
        object: outputWith([suggestionEntry('/a/', 1)]),
        queries: ['first', 'second'], // used (2) reaches limit (2)
        totalUsage: SAMPLE_TOTAL_USAGE,
      });

      await callEngine();

      expect(getInfoSummary()).toMatchObject({
        stopReason: 'budget_exhausted',
        searchCount: 2,
      });
    });

    it('emits the summary with stopReason "error" and still rejects when structured output fails validation', async () => {
      primeGenerate({ informationType: 'neither', suggestions: [] });

      await expect(callEngine()).rejects.toThrow(/validation/);

      expect(mocks.loggerInfoMock).toHaveBeenCalledTimes(1);
      expect(getInfoSummary()).toMatchObject({
        stopReason: 'error',
        informationType: null,
        suggestionCount: 0,
        tokenUsage: null,
      });
    });

    it('emits the summary with stopReason "error" and still rejects when generate itself rejects', async () => {
      mocks.generateMock.mockRejectedValue(new Error('provider down'));

      await expect(callEngine()).rejects.toThrow('provider down');

      expect(mocks.loggerInfoMock).toHaveBeenCalledTimes(1);
      expect(getInfoSummary()).toMatchObject({
        stopReason: 'error',
        searchCount: 0,
        pageReadCount: 0,
        informationType: null,
        suggestionCount: 0,
        tokenUsage: null,
      });
    });

    it('emits the summary with the known informationType and rethrows when grant resolution fails', async () => {
      primeGenerate(outputWith([suggestionEntry('/a/', 1)], 'flow'));
      mocks.resolveParentGrantMock.mockRejectedValueOnce(
        new Error('mongo down'),
      );

      await expect(callEngine()).rejects.toThrow('mongo down');

      expect(mocks.loggerInfoMock).toHaveBeenCalledTimes(1);
      expect(getInfoSummary()).toMatchObject({
        stopReason: 'error',
        informationType: 'flow',
        suggestionCount: 0,
      });
    });

    it('emits the summary with stopReason "timeout" and still rejects when the timeout aborts generate', async () => {
      vi.useFakeTimers();
      armAbortAwareGenerate();

      const enginePromise = callEngine();
      const rejection = expect(enginePromise).rejects.toThrow(
        'agentic engine timed out after 60000ms',
      );
      await vi.advanceTimersByTimeAsync(60_000);
      await rejection;

      expect(mocks.loggerInfoMock).toHaveBeenCalledTimes(1);
      expect(getInfoSummary()).toMatchObject({
        stopReason: 'timeout',
        informationType: null,
        suggestionCount: 0,
      });
    });

    it('keeps body-derived strings (queries, snippets, document body) out of the info level', async () => {
      const secretQuery = 'SECRET-BODY-DERIVED-QUERY';
      const secretSnippet = 'SECRET-PAGE-BODY-SNIPPET';
      primeGenerateWithExploration({
        object: outputWith([suggestionEntry('/a/', 1)]),
        queries: [secretQuery],
        steps: [
          {
            toolCalls: [
              toolCallChunk('fullTextSearch', { query: secretQuery }),
            ],
            toolResults: [
              toolResultChunk('fullTextSearch', {
                result: 'ok',
                hits: [
                  { pageId: 'p1', pagePath: '/a/page', snippet: secretSnippet },
                ],
                totalCount: 1,
              }),
            ],
          },
        ],
        totalUsage: SAMPLE_TOTAL_USAGE,
      });

      await callEngine();

      // Guard against vacuous truth: the privacy assertions below are only
      // meaningful when a summary line was actually emitted.
      expect(mocks.loggerInfoMock).toHaveBeenCalledTimes(1);
      const serializedInfoCalls = JSON.stringify(
        mocks.loggerInfoMock.mock.calls,
      );
      expect(serializedInfoCalls).not.toContain(secretQuery);
      expect(serializedInfoCalls).not.toContain(secretSnippet);
      expect(serializedInfoCalls).not.toContain('Some document content');
    });

    it('emits a debug trace with the executed query sequence, hit summaries, and the tool-call sequence', async () => {
      primeGenerateWithExploration({
        object: outputWith([suggestionEntry('/a/', 1)]),
        queries: ['first query', 'second query'],
        steps: [
          {
            toolCalls: [
              toolCallChunk('fullTextSearch', { query: 'first query' }),
              toolCallChunk('fullTextSearch', { query: 'second query' }),
            ],
            toolResults: [
              toolResultChunk('fullTextSearch', {
                result: 'ok',
                hits: [
                  { pageId: 'p1', pagePath: '/a/hit-1', snippet: 'excerpt' },
                  { pageId: 'p2', pagePath: '/a/hit-2' },
                ],
                totalCount: 12,
              }),
              toolResultChunk('fullTextSearch', {
                result: 'error',
                reason: 'es down',
              }),
            ],
          },
          {
            toolCalls: [toolCallChunk('getPageContent', { pageId: 'p1' })],
            toolResults: [
              toolResultChunk('getPageContent', { body: 'page body text' }),
            ],
          },
        ],
        totalUsage: SAMPLE_TOTAL_USAGE,
      });

      await callEngine();

      expect(mocks.loggerDebugMock).toHaveBeenCalledTimes(1);
      const [trace] = mocks.loggerDebugMock.mock.calls[0];
      // Exact shape: hit summaries carry kind/count/paths only (snippets are
      // page-body excerpts and stay out even at debug), and tool RESULTS are
      // never logged (getPageContent results contain page bodies).
      expect(trace).toEqual({
        queries: ['first query', 'second query'],
        listedPaths: [],
        searchResults: [
          {
            resultKind: 'ok',
            totalCount: 12,
            hitPaths: ['/a/hit-1', '/a/hit-2'],
          },
          { resultKind: 'error', totalCount: null, hitPaths: [] },
        ],
        toolCallSequence: [
          { toolName: 'fullTextSearch', args: { query: 'first query' } },
          { toolName: 'fullTextSearch', args: { query: 'second query' } },
          { toolName: 'getPageContent', args: { pageId: 'p1' } },
        ],
      });
    });

    it('never lets malformed steps break the engine: suggestions still returned, counts fall back to zero/empty', async () => {
      primeGenerateWithExploration({
        object: outputWith([suggestionEntry('/a/', 1)]),
        steps: 'not-an-array',
        totalUsage: 7, // malformed: not an object
      });

      const result = await callEngine();

      expect(result).toHaveLength(1);
      expect(getInfoSummary()).toMatchObject({
        pageReadCount: 0,
        tokenUsage: null,
      });
      expect(mocks.loggerDebugMock.mock.calls[0]?.[0]).toMatchObject({
        searchResults: [],
        toolCallSequence: [],
      });
    });
  });
});
