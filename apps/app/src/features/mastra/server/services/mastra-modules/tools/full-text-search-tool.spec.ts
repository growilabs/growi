import type { IUserHasId } from '@growi/core';
import { RequestContext } from '@mastra/core/request-context';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ISearchResult } from '~/interfaces/search';
import type SearchService from '~/server/service/search';

import type { MastraRequestContextShape } from '../types/request-context';
import { fullTextSearchTool } from './full-text-search-tool';

// Suppress logger noise from the tool under test. The factory shape mirrors
// other specs (e.g. generate-suggestions.spec.ts) — every level is a no-op.
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

// Helper to construct a typed RequestContext used by the tool.
const buildRequestContext = (): RequestContext<MastraRequestContextShape> =>
  new RequestContext<MastraRequestContextShape>();

// Minimal IUserHasId-shaped object. The tool MUST pass this through by
// reference (no synthetic re-creation, no User.findById round-trip).
const buildMockUser = (): IUserHasId =>
  ({
    _id: 'user1',
    name: 'test-user',
    username: 'test-user',
  }) as unknown as IUserHasId;

type MockSearchService = {
  isElasticsearchEnabled: boolean;
  searchKeyword: ReturnType<typeof vi.fn>;
};

const buildMockSearchService = (
  overrides: Partial<MockSearchService> = {},
): MockSearchService => ({
  isElasticsearchEnabled: true,
  searchKeyword: vi.fn(),
  ...overrides,
});

// Cast helper: tests only exercise the two fields the tool actually reads.
const asSearchService = (m: MockSearchService): SearchService =>
  m as unknown as SearchService;

// Invoke the tool's execute. The mastra runtime calls execute with
// `(inputData, { requestContext, ... })`, so tests mirror that shape.
const invokeExecute = (
  inputData: { query: string; limit?: number },
  requestContext: RequestContext<MastraRequestContextShape>,
) => {
  // biome-ignore lint/style/noNonNullAssertion: createTool always wires execute
  return fullTextSearchTool.execute!(
    inputData as never,
    {
      requestContext,
    } as never,
  );
};

describe('fullTextSearchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('input validation (zod)', () => {
    it('rejects an empty query before reaching execute body', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      const mockSearchService = buildMockSearchService();
      requestContext.set('user', mockUser);
      requestContext.set('searchService', asSearchService(mockSearchService));

      // Mastra wraps execute with validateToolInput. An empty `query` violates
      // the zod `min(1)` rule, so the wrapper returns a ValidationError object
      // without ever invoking the user-provided execute body.
      const result = (await invokeExecute(
        { query: '', limit: 5 },
        requestContext,
      )) as { error?: boolean; validationErrors?: unknown };

      expect(result).toBeDefined();
      expect(result.error).toBe(true);
      expect(result.validationErrors).toBeDefined();
      // The execute body never ran, so searchKeyword was not called.
      expect(mockSearchService.searchKeyword).not.toHaveBeenCalled();
    });
  });

  describe('context guards', () => {
    it('returns context_error when user is missing from requestContext', async () => {
      const requestContext = buildRequestContext();
      const mockSearchService = buildMockSearchService();
      // Intentionally do NOT set 'user'.
      requestContext.set('searchService', asSearchService(mockSearchService));

      const result = (await invokeExecute(
        { query: 'hello', limit: 5 },
        requestContext,
      )) as { result: string; reason?: string };

      expect(result.result).toBe('context_error');
      expect(typeof result.reason).toBe('string');
      expect(result.reason?.length ?? 0).toBeGreaterThan(0);
      expect(mockSearchService.searchKeyword).not.toHaveBeenCalled();
    });

    it('returns context_error when searchService is missing from requestContext', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      // Intentionally do NOT set 'searchService'.
      requestContext.set('user', mockUser);

      const result = (await invokeExecute(
        { query: 'hello', limit: 5 },
        requestContext,
      )) as { result: string; reason?: string };

      expect(result.result).toBe('context_error');
    });
  });

  describe('Elasticsearch disabled', () => {
    it("returns result: 'error' with reason 'elasticsearch_not_configured'", async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      const mockSearchService = buildMockSearchService({
        isElasticsearchEnabled: false,
      });
      requestContext.set('user', mockUser);
      requestContext.set('searchService', asSearchService(mockSearchService));

      const result = (await invokeExecute(
        { query: 'hello', limit: 5 },
        requestContext,
      )) as { result: string; reason?: string };

      expect(result.result).toBe('error');
      expect(result.reason).toBe('elasticsearch_not_configured');
      // Critical: must short-circuit BEFORE delegating to the search service.
      expect(mockSearchService.searchKeyword).not.toHaveBeenCalled();
    });
  });

  describe('SearchService exception handling', () => {
    it("converts thrown errors into result: 'error' without throwing out of execute", async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      const mockSearchService = buildMockSearchService();
      mockSearchService.searchKeyword.mockRejectedValue(new Error('boom'));
      requestContext.set('user', mockUser);
      requestContext.set('searchService', asSearchService(mockSearchService));

      // Must NOT throw — requirement 6.8 demands the agent loop keep running.
      await expect(
        invokeExecute({ query: 'anything', limit: 5 }, requestContext),
      ).resolves.toMatchObject({ result: 'error' });
    });

    it('propagates the original Error message into the reason field when available', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      const mockSearchService = buildMockSearchService();
      mockSearchService.searchKeyword.mockRejectedValue(
        new Error('boom-detail'),
      );
      requestContext.set('user', mockUser);
      requestContext.set('searchService', asSearchService(mockSearchService));

      const result = (await invokeExecute(
        { query: 'anything', limit: 5 },
        requestContext,
      )) as { result: string; reason?: string };

      expect(result.result).toBe('error');
      expect(result.reason).toBe('boom-detail');
    });
  });

  describe('success mapping', () => {
    it('maps SearchService results to { pageId, pagePath, snippet } and never leaks body', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      const mockSearchService = buildMockSearchService();
      const searchResult: ISearchResult<unknown> = {
        data: [
          {
            _id: 'abc',
            _score: 1,
            _source: { path: '/p1', body: 'HIDDEN_BODY' },
            _highlight: { body: ['snip'] },
          },
        ],
        meta: { total: 1, hitsCount: 1 },
      };
      mockSearchService.searchKeyword.mockResolvedValue([
        searchResult,
        'es-delegator',
      ]);
      requestContext.set('user', mockUser);
      requestContext.set('searchService', asSearchService(mockSearchService));

      const result = (await invokeExecute(
        { query: 'hello', limit: 5 },
        requestContext,
      )) as {
        result: string;
        hits: Array<{ pageId: string; pagePath: string; snippet?: string }>;
        totalCount: number;
      };

      expect(result.result).toBe('ok');
      expect(result.totalCount).toBe(1);
      // Exact shape — `body` must NOT appear on the hit.
      expect(result.hits).toHaveLength(1);
      expect(result.hits[0]).toEqual({
        pageId: 'abc',
        pagePath: '/p1',
        snippet: 'snip',
      });

      // Defense-in-depth: serialise the whole result and assert the raw
      // body string and the literal key 'body' never appear anywhere
      // (guards requirement 6.5 even if the mapping shape changes).
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('HIDDEN_BODY');
      expect(serialized).not.toContain('"body"');
    });

    it('omits snippet when the highlight is absent', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      const mockSearchService = buildMockSearchService();
      const searchResult: ISearchResult<unknown> = {
        data: [
          {
            _id: 'noHighlight',
            _score: 1,
            _source: { path: '/p2' },
            _highlight: undefined,
          },
        ],
        meta: { total: 1, hitsCount: 1 },
      };
      mockSearchService.searchKeyword.mockResolvedValue([
        searchResult,
        'es-delegator',
      ]);
      requestContext.set('user', mockUser);
      requestContext.set('searchService', asSearchService(mockSearchService));

      const result = (await invokeExecute(
        { query: 'hello', limit: 5 },
        requestContext,
      )) as {
        result: string;
        hits: Array<{ pageId: string; pagePath: string; snippet?: string }>;
      };

      expect(result.result).toBe('ok');
      expect(result.hits[0]).toEqual({
        pageId: 'noHighlight',
        pagePath: '/p2',
      });
      // No snippet field when highlight is absent (must be omitted, not "").
      expect(Object.hasOwn(result.hits[0], 'snippet')).toBe(false);
    });
  });

  describe('user reference identity (requirement 6.7 / Issue 1 Plan C regression guard)', () => {
    it("passes the exact mockUser reference (===) to searchKeyword's 3rd argument", async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      const mockSearchService = buildMockSearchService();
      const searchResult: ISearchResult<unknown> = {
        data: [],
        meta: { total: 0, hitsCount: 0 },
      };
      mockSearchService.searchKeyword.mockResolvedValue([
        searchResult,
        'es-delegator',
      ]);
      requestContext.set('user', mockUser);
      requestContext.set('searchService', asSearchService(mockSearchService));

      await invokeExecute({ query: 'hello', limit: 5 }, requestContext);

      expect(mockSearchService.searchKeyword).toHaveBeenCalledTimes(1);
      // Strict reference equality — the tool must NOT clone, rebuild from
      // _id, or otherwise synthesise a new user object.
      expect(mockSearchService.searchKeyword.mock.calls[0][2]).toBe(mockUser);
    });
  });

  describe('query pass-through (sanitiser-absence guarantee, Plan A regression guard)', () => {
    it("forwards the query string verbatim to searchKeyword's 1st argument", async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      const mockSearchService = buildMockSearchService();
      const searchResult: ISearchResult<unknown> = {
        data: [],
        meta: { total: 0, hitsCount: 0 },
      };
      mockSearchService.searchKeyword.mockResolvedValue([
        searchResult,
        'es-delegator',
      ]);
      requestContext.set('user', mockUser);
      requestContext.set('searchService', asSearchService(mockSearchService));

      // Composite operator query: prefix:, exclusion, tag:, phrase.
      const rawQuery = 'prefix:/docs -draft tag:meeting "release notes"';

      await invokeExecute({ query: rawQuery, limit: 5 }, requestContext);

      expect(mockSearchService.searchKeyword).toHaveBeenCalledTimes(1);
      expect(mockSearchService.searchKeyword.mock.calls[0][0]).toBe(rawQuery);
      // 2nd arg (nqName) must be null — SearchService resolves the default
      // delegator name internally; the tool must not pass a string here.
      expect(mockSearchService.searchKeyword.mock.calls[0][1]).toBeNull();
      // 4th arg (userGroups) must be null — SearchService derives groups
      // from `user` internally.
      expect(mockSearchService.searchKeyword.mock.calls[0][3]).toBeNull();
    });
  });
});
