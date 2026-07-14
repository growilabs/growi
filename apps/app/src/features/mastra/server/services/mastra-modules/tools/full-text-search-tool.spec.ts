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

// Mock both user-group relation models. The tool resolves user-group ids the
// same way as the existing /_search route — these calls must be controllable
// from the test so we can pass deterministic ids (or an empty array) into
// SearchService.searchKeyword's 4th argument.
const mocks = vi.hoisted(() => ({
  userGroupRelationFindAllMock: vi.fn(),
  externalUserGroupRelationFindAllMock: vi.fn(),
}));

vi.mock('~/server/models/user-group-relation', () => ({
  default: {
    findAllUserGroupIdsRelatedToUser: mocks.userGroupRelationFindAllMock,
  },
}));

vi.mock(
  '~/features/external-user-group/server/models/external-user-group-relation',
  () => ({
    default: {
      findAllUserGroupIdsRelatedToUser:
        mocks.externalUserGroupRelationFindAllMock,
    },
  }),
);

// Helper to construct a typed RequestContext used by the tool.
const buildRequestContext = (): RequestContext<MastraRequestContextShape> =>
  new RequestContext<MastraRequestContextShape>();

// Minimal IUserHasId-shaped object. The tool MUST pass this through by
// reference (no synthetic re-creation, no User.findById round-trip).
// The single cast inside this builder is the ONLY boundary where we admit
// that our test fixture isn't a full Mongoose document — every call site
// stays cast-free.
const buildMockUser = (): IUserHasId =>
  ({
    _id: 'user1',
    name: 'test-user',
    username: 'test-user',
  }) as unknown as IUserHasId;

type MockSearchService = {
  isElasticsearchEnabled: boolean;
  searchKeyword: ReturnType<typeof vi.fn>;
  formatSearchResult: ReturnType<typeof vi.fn>;
};

// Build a SearchService-typed mock. The cast inside this builder isolates
// the boundary where the mock satisfies the SearchService interface — the
// tool only reads `isElasticsearchEnabled`, `searchKeyword` and
// `formatSearchResult`, so a partial stub typed as the real class is
// sufficient. Call sites stay cast-free. `formatSearchResult` defaults to an
// empty formatted result so argument-forwarding tests need not restate it.
const buildMockSearchService = (
  overrides: Partial<MockSearchService> = {},
): MockSearchService & SearchService => {
  const mock: MockSearchService = {
    isElasticsearchEnabled: true,
    searchKeyword: vi.fn(),
    formatSearchResult: vi
      .fn()
      .mockResolvedValue({ data: [], meta: { total: 0, hitsCount: 0 } }),
    ...overrides,
  };
  return mock as unknown as MockSearchService & SearchService;
};

// Discriminated union mirroring the tool's outputSchema. Defined locally so
// callers can read `result.result === 'ok'` and access `.hits` / `.reason`
// without per-call narrowing casts.
type FullTextSearchToolResult =
  | {
      result: 'ok';
      hits: Array<{ pageId: string; pagePath: string; snippet?: string }>;
      totalCount: number;
    }
  | { result: 'error' | 'context_error'; reason: string };

// Mastra's validateToolInput wrapper returns this envelope shape (not the
// discriminated union) when zod input validation fails.
type ValidationFailure = { error: true; validationErrors: unknown };

// Invoke the tool's execute. The mastra runtime calls execute with
// `(inputData, { requestContext, ... })`, so tests mirror that shape.
const invokeExecute = async (
  inputData: {
    query: string;
    limit?: number;
    sort?: string;
    order?: string;
  },
  requestContext: RequestContext<MastraRequestContextShape>,
): Promise<FullTextSearchToolResult | ValidationFailure> => {
  // The Mastra runtime's `execute` signature is intentionally loose
  // (`unknown` input / output), so a single `as never` per arg is unavoidable
  // here. Narrow the return shape ONCE so callers don't repeat the cast.
  // biome-ignore lint/style/noNonNullAssertion: createTool always wires execute
  const result = await fullTextSearchTool.execute!(
    inputData as never,
    { requestContext } as never,
  );
  return result as FullTextSearchToolResult | ValidationFailure;
};

// Type-guard to discriminate the validation envelope from the success/error
// discriminated union without a cast at the call site.
const isValidationFailure = (
  r: FullTextSearchToolResult | ValidationFailure,
): r is ValidationFailure => 'error' in r && r.error === true;

describe('fullTextSearchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: both relation lookups return empty arrays. Individual tests
    // override these with mockResolvedValueOnce / mockRejectedValueOnce when
    // they need specific group ids or a thrown error.
    mocks.userGroupRelationFindAllMock.mockResolvedValue([]);
    mocks.externalUserGroupRelationFindAllMock.mockResolvedValue([]);
  });

  describe('input validation (zod)', () => {
    it('rejects an empty query before reaching execute body', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      const mockSearchService = buildMockSearchService();
      requestContext.set('user', mockUser);
      requestContext.set('searchService', mockSearchService);

      // Mastra wraps execute with validateToolInput. An empty `query` violates
      // the zod `min(1)` rule, so the wrapper returns a ValidationError object
      // without ever invoking the user-provided execute body.
      const result = await invokeExecute(
        { query: '', limit: 5 },
        requestContext,
      );

      expect(result).toBeDefined();
      expect(isValidationFailure(result)).toBe(true);
      if (isValidationFailure(result)) {
        expect(result.validationErrors).toBeDefined();
      }
      // The execute body never ran, so searchKeyword was not called.
      expect(mockSearchService.searchKeyword).not.toHaveBeenCalled();
    });
  });

  describe('context guards', () => {
    it('returns context_error when user is missing from requestContext', async () => {
      const requestContext = buildRequestContext();
      const mockSearchService = buildMockSearchService();
      // Intentionally do NOT set 'user'.
      requestContext.set('searchService', mockSearchService);

      const result = await invokeExecute(
        { query: 'hello', limit: 5 },
        requestContext,
      );

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('context_error');
      if (result.result === 'context_error' || result.result === 'error') {
        expect(typeof result.reason).toBe('string');
        expect(result.reason.length).toBeGreaterThan(0);
      }
      expect(mockSearchService.searchKeyword).not.toHaveBeenCalled();
    });

    it('returns context_error when searchService is missing from requestContext', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      // Intentionally do NOT set 'searchService'.
      requestContext.set('user', mockUser);

      const result = await invokeExecute(
        { query: 'hello', limit: 5 },
        requestContext,
      );

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
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
      requestContext.set('searchService', mockSearchService);

      const result = await invokeExecute(
        { query: 'hello', limit: 5 },
        requestContext,
      );

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('error');
      if (result.result === 'error' || result.result === 'context_error') {
        expect(result.reason).toBe('elasticsearch_not_configured');
      }
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
      requestContext.set('searchService', mockSearchService);

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
      requestContext.set('searchService', mockSearchService);

      const result = await invokeExecute(
        { query: 'anything', limit: 5 },
        requestContext,
      );

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('error');
      if (result.result === 'error' || result.result === 'context_error') {
        expect(result.reason).toBe('boom-detail');
      }
    });
  });

  describe('success mapping', () => {
    it('routes the raw result through formatSearchResult and maps its output to { pageId, pagePath, snippet } without leaking body', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      const mockSearchService = buildMockSearchService();
      // The tool no longer reads `_highlight` itself — it hands the raw result
      // to formatSearchResult, which owns the highlight-key fallback and the
      // canShowSnippet gate. Here we only verify the wiring + output mapping.
      const searchResult: ISearchResult<unknown> = {
        data: [],
        meta: { total: 1, hitsCount: 1 },
      };
      mockSearchService.searchKeyword.mockResolvedValue([
        searchResult,
        'es-delegator',
      ]);
      // formatSearchResult returns IFormattedSearchResult: each entry has the
      // full page document under `.data` and the snippet under
      // `.meta.elasticSearchResult.snippet`. `body` is included on `.data` to
      // prove the tool projects only _id / path (requirement 6.5).
      mockSearchService.formatSearchResult.mockResolvedValue({
        data: [
          {
            data: { _id: 'abc', path: '/p1', body: 'HIDDEN_BODY' },
            meta: {
              elasticSearchResult: { snippet: 'snip', highlightedPath: null },
            },
          },
        ],
        meta: { total: 1, hitsCount: 1 },
      });
      requestContext.set('user', mockUser);
      requestContext.set('searchService', mockSearchService);

      const result = await invokeExecute(
        { query: 'hello', limit: 5 },
        requestContext,
      );

      // The raw result and the searchKeyword-returned delegatorName must be
      // forwarded to formatSearchResult, along with user + resolved userGroups.
      expect(mockSearchService.formatSearchResult).toHaveBeenCalledTimes(1);
      expect(mockSearchService.formatSearchResult.mock.calls[0][0]).toBe(
        searchResult,
      );
      expect(mockSearchService.formatSearchResult.mock.calls[0][1]).toBe(
        'es-delegator',
      );
      expect(mockSearchService.formatSearchResult.mock.calls[0][2]).toBe(
        mockUser,
      );
      expect(mockSearchService.formatSearchResult.mock.calls[0][3]).toEqual([]);

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('ok');
      if (result.result !== 'ok') return;
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

    it('omits snippet when formatSearchResult yields a null snippet (canShowSnippet gate)', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      const mockSearchService = buildMockSearchService();
      mockSearchService.searchKeyword.mockResolvedValue([
        { data: [], meta: { total: 1, hitsCount: 1 } },
        'es-delegator',
      ]);
      // snippet: null is what canShowSnippet produces for a page the caller
      // cannot view — the tool must omit the key entirely (not emit "").
      mockSearchService.formatSearchResult.mockResolvedValue({
        data: [
          {
            data: { _id: 'noSnippet', path: '/p2' },
            meta: {
              elasticSearchResult: { snippet: null, highlightedPath: null },
            },
          },
        ],
        meta: { total: 1, hitsCount: 1 },
      });
      requestContext.set('user', mockUser);
      requestContext.set('searchService', mockSearchService);

      const result = await invokeExecute(
        { query: 'hello', limit: 5 },
        requestContext,
      );

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('ok');
      if (result.result !== 'ok') return;
      expect(result.hits[0]).toEqual({
        pageId: 'noSnippet',
        pagePath: '/p2',
      });
      // No snippet field when the gate drops it (must be omitted, not "").
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
      requestContext.set('searchService', mockSearchService);

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
      requestContext.set('searchService', mockSearchService);

      // Composite operator query: prefix:, exclusion, tag:, phrase.
      const rawQuery = 'prefix:/docs -draft tag:meeting "release notes"';

      await invokeExecute({ query: rawQuery, limit: 5 }, requestContext);

      expect(mockSearchService.searchKeyword).toHaveBeenCalledTimes(1);
      expect(mockSearchService.searchKeyword.mock.calls[0][0]).toBe(rawQuery);
      // 2nd arg (nqName) must be null — SearchService resolves the default
      // delegator name internally; the tool must not pass a string here.
      expect(mockSearchService.searchKeyword.mock.calls[0][1]).toBeNull();
      // 4th arg (userGroups) must be the resolved array — SearchService does
      // NOT derive groups from `user` internally. With both relation mocks
      // returning [] in beforeEach, the resolved array is [].
      expect(mockSearchService.searchKeyword.mock.calls[0][3]).toEqual([]);
    });
  });

  describe('userGroups resolution (Task 2.1 fix — see server/routes/search.ts:143-151)', () => {
    it('concatenates UserGroupRelation + ExternalUserGroupRelation ids into the 4th argument', async () => {
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
      requestContext.set('searchService', mockSearchService);

      const gid1 = 'group-id-internal';
      const gid2 = 'group-id-external';
      mocks.userGroupRelationFindAllMock.mockResolvedValueOnce([gid1]);
      mocks.externalUserGroupRelationFindAllMock.mockResolvedValueOnce([gid2]);

      await invokeExecute({ query: 'hello', limit: 5 }, requestContext);

      expect(mockSearchService.searchKeyword).toHaveBeenCalledTimes(1);
      // Order matters: internal relation ids first, then external ones —
      // matches the spread order in full-text-search-tool.ts.
      expect(mockSearchService.searchKeyword.mock.calls[0][3]).toEqual([
        gid1,
        gid2,
      ]);
      // Both relation lookups must have received the same user reference.
      expect(mocks.userGroupRelationFindAllMock).toHaveBeenCalledWith(mockUser);
      expect(mocks.externalUserGroupRelationFindAllMock).toHaveBeenCalledWith(
        mockUser,
      );
    });

    it("converts exceptions thrown by findAllUserGroupIdsRelatedToUser into result: 'error' without throwing out of execute (requirement 6.8)", async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      const mockSearchService = buildMockSearchService();
      requestContext.set('user', mockUser);
      requestContext.set('searchService', mockSearchService);

      mocks.userGroupRelationFindAllMock.mockRejectedValueOnce(
        new Error('user-group-relation-failed'),
      );

      // Must NOT throw — the try/catch envelope around the resolution + search
      // call converts the exception into a structured error value.
      const result = await invokeExecute(
        { query: 'hello', limit: 5 },
        requestContext,
      );

      expect(isValidationFailure(result)).toBe(false);
      if (isValidationFailure(result)) return;
      expect(result.result).toBe('error');
      if (result.result === 'error' || result.result === 'context_error') {
        expect(result.reason).toBe('user-group-relation-failed');
      }
      // searchKeyword must not be reached when group resolution fails.
      expect(mockSearchService.searchKeyword).not.toHaveBeenCalled();
    });
  });

  describe('sort / order pass-through (requirement 6.9)', () => {
    it('forwards explicit sort: updatedAt + order: asc verbatim to searchKeyword (5th positional argument)', async () => {
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
      requestContext.set('searchService', mockSearchService);

      await invokeExecute(
        { query: 'hello', limit: 10, sort: 'updatedAt', order: 'asc' },
        requestContext,
      );

      expect(mockSearchService.searchKeyword).toHaveBeenCalledTimes(1);
      // The other 4 positional args remain as before — query/null/user/userGroups.
      expect(mockSearchService.searchKeyword.mock.calls[0][0]).toBe('hello');
      expect(mockSearchService.searchKeyword.mock.calls[0][1]).toBeNull();
      expect(mockSearchService.searchKeyword.mock.calls[0][2]).toBe(mockUser);
      expect(mockSearchService.searchKeyword.mock.calls[0][3]).toEqual([]);
      // 5th positional argument (searchOpts) must include sort/order verbatim
      // alongside the existing limit. Use deep equality on the whole object so
      // that adding/removing keys requires updating this test deliberately.
      expect(mockSearchService.searchKeyword.mock.calls[0][4]).toEqual({
        limit: 10,
        sort: 'updatedAt',
        order: 'asc',
      });
    });

    it('applies zod defaults when sort / order are omitted (sort: relationScore, order: desc)', async () => {
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
      requestContext.set('searchService', mockSearchService);

      // Omit sort / order entirely; zod `.default(...)` should fire before
      // execute is invoked, so the tool body receives the defaults.
      await invokeExecute({ query: 'hello', limit: 5 }, requestContext);

      expect(mockSearchService.searchKeyword).toHaveBeenCalledTimes(1);
      // Use objectContaining (not strict toEqual) so that the limit value, which
      // some other tests may change independently, does not over-constrain.
      expect(mockSearchService.searchKeyword.mock.calls[0][4]).toEqual(
        expect.objectContaining({
          sort: 'relationScore',
          order: 'desc',
        }),
      );
    });

    it('rejects an invalid sort enum value at the zod boundary without invoking searchKeyword', async () => {
      const requestContext = buildRequestContext();
      const mockUser = buildMockUser();
      const mockSearchService = buildMockSearchService();
      requestContext.set('user', mockUser);
      requestContext.set('searchService', mockSearchService);

      // 'unknown_axis' is not in SORT_AXIS; Mastra's validateToolInput wrapper
      // must reject it before the execute body runs, mirroring the empty-query
      // validation-error envelope.
      // The cast is intentional: this test deliberately violates the input
      // schema to verify zod rejection. `as unknown as ...` (rather than `any`)
      // keeps the erasure scoped — we still type the invokeExecute parameter.
      const invalidInput = {
        query: 'hello',
        limit: 5,
        sort: 'unknown_axis',
      } as unknown as { query: string; limit: number; sort: string };

      const result = await invokeExecute(invalidInput, requestContext);

      expect(result).toBeDefined();
      expect(isValidationFailure(result)).toBe(true);
      if (isValidationFailure(result)) {
        expect(result.validationErrors).toBeDefined();
      }
      expect(mockSearchService.searchKeyword).not.toHaveBeenCalled();
    });
  });
});
