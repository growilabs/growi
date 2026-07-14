import type { IUserHasId } from '@growi/core';
import { RequestContext } from '@mastra/core/request-context';
import mongoose, { type Model } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type { ISearchResult, ISearchResultData } from '~/interfaces/search';
import type Crowi from '~/server/crowi';
import type { QueryTerms, SearchDelegator } from '~/server/interfaces/search';
import type { PageDocument, PageModel } from '~/server/models/page';
import SearchService from '~/server/service/search';

import type { MastraRequestContextShape } from '../types/request-context';
import { fullTextSearchTool } from './full-text-search-tool';

// This integration test does NOT connect to a real Elasticsearch. Reasons:
//   1. The existing `apps/app/src/server/service/search/search-service.integ.ts`
//      follows the convention of injecting a `dummyFullTextSearchDelegator`
//      into `searchService.nqDelegators`; this spec adopts the same pattern.
//   2. The GitHub Actions test job that runs `pnpm run test` has no
//      `services.elasticsearch` (one is defined only in `reusable-app-prod.yml`
//      for production build / launch). Wiring up a real ES integration test
//      would be a repo-first effort — the CI instability and workflow churn
//      are not worth the marginal coverage gain.
//   3. ES query DSL assembly and `filterPagesByViewer` grant enforcement are
//      out of scope for this spec — they belong to `SearchService` /
//      `ElasticsearchDelegator`. This tool's test value is scoped to
//      "argument forwarding from the tool layer to SearchService and
//      return-value mapping".
//
// What is intentionally NOT tested here:
//   - `filterPagesByViewer` result-visibility grant enforcement on a real ES
//     index (covered by the layers above). The dummy delegator returns hits
//     verbatim, so a page appears in `searchResult.data` regardless of grant —
//     which is exactly what lets us assert the snippet-visibility gate below.
//   - ES query DSL assembly (same).
//
// What is still tested:
//   - The tool calls `SearchService.searchKeyword` with the correct
//     positional arguments (query / null / user / userGroups / searchOpts).
//   - `userGroups` is resolved from real MongoDB via `UserGroupRelation`.
//   - Hits are routed through `SearchService.formatSearchResult` and mapped to
//     `{ pageId, pagePath, snippet }` against a real page document, without
//     leaking the page body.
//   - The snippet is taken from the `formatSearchResult` output, so the
//     `body.ja` / `body.en` highlight keys produced by plain keyword matches
//     (not just the phrase-only `body` key) reach the agent.
//   - The `canShowSnippet` visibility gate drops the snippet for a page the
//     caller cannot view (GRANT_OWNER owned by another user) while still
//     returning the hit.
//   - Delegator exceptions become `{ result: 'error' }` without rethrowing.

// Suppress logger noise from the tool body itself.
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';

type FullTextSearchOkResult = {
  result: 'ok';
  hits: Array<{ pageId: string; pagePath: string; snippet?: string }>;
  totalCount: number;
};

type FullTextSearchFailureResult = {
  result: 'error' | 'context_error';
  reason: string;
};

type FullTextSearchResult =
  | FullTextSearchOkResult
  | FullTextSearchFailureResult;

// Invoke the tool's execute the same way the Mastra runtime does. The two
// `as never` args are unavoidable: Mastra's `execute` signature uses
// `unknown` for both input and the context envelope. Narrowing the return
// shape once here keeps every call site cast-free.
const invokeExecute = async (
  inputData: {
    query: string;
    limit?: number;
    sort?: string;
    order?: string;
  },
  requestContext: RequestContext<MastraRequestContextShape>,
): Promise<FullTextSearchResult> => {
  // biome-ignore lint/style/noNonNullAssertion: createTool always wires execute
  const result = await fullTextSearchTool.execute!(
    inputData as never,
    { requestContext } as never,
  );
  return result as FullTextSearchResult;
};

// Narrowing assertion: fails the test if the tool returned an error envelope,
// which would otherwise mask the real failure as "undefined hits" downstream.
function assertOk(
  result: FullTextSearchResult,
): asserts result is FullTextSearchOkResult {
  expect(result.result).toBe('ok');
}

// Asserts the tool returned an error/context_error envelope.
function assertFailure(
  result: FullTextSearchResult,
): asserts result is FullTextSearchFailureResult {
  expect(result.result === 'error' || result.result === 'context_error').toBe(
    true,
  );
}

// Mock SearchDelegator. The `as unknown as` cast at the return site isolates
// the boundary where a vi.fn() is admitted as a SearchDelegator — the tool
// only invokes `search`, so a partial stub is sufficient. Call sites cast-free.
type SearchDelegatorMock = SearchDelegator & {
  search: ReturnType<typeof vi.fn>;
};

const buildDummyFullTextDelegator = (
  searchImpl?: (
    ...args: unknown[]
  ) => Promise<ISearchResult<ISearchResultData>>,
): SearchDelegatorMock => {
  const defaultImpl = (): Promise<ISearchResult<ISearchResultData>> =>
    Promise.resolve({ data: [], meta: { total: 0, hitsCount: 0 } });
  return {
    name: 'FullTextSearch',
    search: vi.fn(searchImpl ?? defaultImpl),
    isTermsNormalized(
      _terms: Partial<QueryTerms>,
    ): _terms is Partial<QueryTerms> {
      return true;
    },
    validateTerms() {
      return [];
    },
  } as unknown as SearchDelegatorMock;
};

const DEFAULT_DELEGATOR_KEY = 'FullTextSearch';

describe('fullTextSearchTool (integration, dummy delegator)', () => {
  let crowi: Crowi;
  let searchService: SearchService;
  let User: Model<IUserHasId>;
  let UserGroup: Model<{ name: string }>;
  let UserGroupRelation: Model<{
    relatedGroup: mongoose.Types.ObjectId;
    relatedUser: mongoose.Types.ObjectId;
  }>;
  let Page: PageModel;

  let userA: IUserHasId;
  let userB: IUserHasId;
  let groupG: { _id: mongoose.Types.ObjectId };

  // A GRANT_PUBLIC page — snippet is visible to any caller.
  let publicPage: { _id: mongoose.Types.ObjectId; path: string };
  // A GRANT_OWNER page owned by userB — visible in dummy-delegator hits, but
  // its snippet must be dropped for userA by the canShowSnippet gate.
  let ownedByOtherPage: { _id: mongoose.Types.ObjectId; path: string };

  beforeAll(async () => {
    crowi = await getInstance();
    searchService = await SearchService.create(crowi);

    // SearchService.create short-circuits its delegator setup
    // when the Elasticsearch URI config is unset, leaving
    // `nqDelegators[DEFAULT]` undefined and `isElasticsearchEnabled === false`.
    // For these tests we want to exercise the real `searchKeyword` dispatch
    // path against an injected dummy delegator, so we:
    //   1. force `isElasticsearchEnabled` to true (the tool's guard reads it),
    //   2. install our dummy delegator under the DEFAULT key so that
    //      `resolve()` returns it.
    // This mirrors the convention established by
    // `apps/app/src/server/service/search/search-service.integ.ts`.
    Object.defineProperty(searchService, 'isElasticsearchEnabled', {
      configurable: true,
      get: () => true,
    });

    // Pass the document shape as a generic so the model is typed as
    // `Model<T>` instead of `Model<any>`, eliminating per-call casts.
    type UserGroupRelationDoc = {
      relatedGroup: mongoose.Types.ObjectId;
      relatedUser: mongoose.Types.ObjectId;
    };
    User = mongoose.model<IUserHasId>('User');
    UserGroup = mongoose.model<{ name: string }>('UserGroup');
    UserGroupRelation =
      mongoose.model<UserGroupRelationDoc>('UserGroupRelation');
    Page = mongoose.model<PageDocument, PageModel>('Page');

    const userAName = `agentic-search-integ-userA-${WORKER_ID}`;
    const userBName = `agentic-search-integ-userB-${WORKER_ID}`;
    await User.deleteMany({ username: { $in: [userAName, userBName] } });
    const insertedUsers = await User.insertMany([
      {
        name: userAName,
        username: userAName,
        email: `${userAName}@example.com`,
      },
      {
        name: userBName,
        username: userBName,
        email: `${userBName}@example.com`,
      },
    ]);
    userA = insertedUsers[0];
    userB = insertedUsers[1];

    // Group containing user A — used by the userGroups-resolution test below
    // to verify the tool calls UserGroupRelation.findAllUserGroupIdsRelatedToUser
    // against real MongoDB and forwards the result to searchKeyword.
    const groupName = `agentic-search-integ-group-${WORKER_ID}`;
    await UserGroup.deleteMany({ name: groupName });
    const insertedGroup = await UserGroup.create({ name: groupName });
    // Mongoose's `Document._id` is typed as `unknown` from Model.create's
    // return shape; narrow to ObjectId via a single, scoped cast.
    groupG = { _id: insertedGroup._id as mongoose.Types.ObjectId };
    await UserGroupRelation.deleteMany({ relatedGroup: groupG._id });
    await UserGroupRelation.create({
      relatedGroup: groupG._id,
      relatedUser: userA._id,
    });

    // Real page documents. formatSearchResult resolves hits back to these via
    // findPageListByIds (Page.find by _id), then canShowSnippet reads their
    // grant / grantedUsers to decide snippet visibility — so the dummy
    // delegator's hit _ids must reference documents that actually exist.
    const publicPath = `/agentic-search-integ/${WORKER_ID}/public`;
    const ownedByOtherPath = `/agentic-search-integ/${WORKER_ID}/owned-by-other`;
    await Page.deleteMany({ path: { $in: [publicPath, ownedByOtherPath] } });
    const insertedPages = await Page.insertMany([
      {
        path: publicPath,
        grant: Page.GRANT_PUBLIC,
        creator: userA,
        lastUpdateUser: userA,
      },
      {
        path: ownedByOtherPath,
        grant: Page.GRANT_OWNER,
        creator: userB,
        lastUpdateUser: userB,
        grantedUsers: [userB._id],
      },
    ]);
    publicPage = { _id: insertedPages[0]._id, path: publicPath };
    ownedByOtherPage = { _id: insertedPages[1]._id, path: ownedByOtherPath };
  });

  afterAll(async () => {
    // Best-effort cleanup of the Mongo fixtures created above. Tolerate
    // failures so cleanup never masks assertion failures.
    try {
      await Page.deleteMany({
        _id: { $in: [publicPage?._id, ownedByOtherPage?._id] },
      });
      await UserGroupRelation.deleteMany({ relatedGroup: groupG?._id });
      await UserGroup.deleteMany({ _id: groupG?._id });
      await User.deleteMany({ _id: { $in: [userA?._id, userB?._id] } });
    } catch {
      // ignore
    }
  });

  const buildRequestContext = (
    user: IUserHasId,
  ): RequestContext<MastraRequestContextShape> => {
    const ctx = new RequestContext<MastraRequestContextShape>();
    ctx.set('user', user);
    ctx.set('searchService', searchService);
    return ctx;
  };

  // Install the supplied dummy delegator under the DEFAULT key. The
  // searchService instance is shared across tests, so each test that depends
  // on a specific delegator behaviour must call this helper at the top.
  const installDelegator = (delegator: SearchDelegatorMock): void => {
    searchService.nqDelegators = {
      ...searchService.nqDelegators,
      [DEFAULT_DELEGATOR_KEY]: delegator,
    };
  };

  describe('mapping: hit shape', () => {
    it('maps delegator hits to { pageId, pagePath, snippet } without leaking body', async () => {
      const pageId = publicPage._id.toString();
      // The highlight is keyed under `body.ja` — the key ES emits for a plain
      // keyword match (multi_match over body.ja / body.en). The previous
      // implementation only read `_highlight.body` (the phrase-only key) and
      // therefore dropped this snippet; this asserts the regression is fixed.
      const snippet = '<em>match</em> highlighted body';
      // `body` is intentionally included in `_source` to verify it is not
      // surfaced (formatSearchResult only reads tag_names / bookmark_count from
      // _source; the returned page document carries no body) — requirement 6.5
      // (body retrieval belongs to getPageContentTool, not this tool).
      const delegator = buildDummyFullTextDelegator(() =>
        Promise.resolve({
          data: [
            {
              _id: pageId,
              _score: 1,
              _source: {
                path: publicPage.path,
                body: 'FULL_BODY_THAT_MUST_NOT_LEAK',
              },
              _highlight: { 'body.ja': [snippet] },
            },
          ],
          meta: { total: 1, hitsCount: 1 },
        }),
      );
      installDelegator(delegator);

      const result = await invokeExecute(
        { query: 'anything', limit: 20 },
        buildRequestContext(userA),
      );

      assertOk(result);
      expect(result.totalCount).toBe(1);
      expect(result.hits).toHaveLength(1);
      // Strict equality on the hit shape — no extra keys (`body`, `_source`,
      // `_score`, ...) must leak through. pagePath comes from the resolved
      // page document, not the delegator's _source.
      expect(result.hits[0]).toStrictEqual({
        pageId,
        pagePath: publicPage.path,
        snippet,
      });
      // Defence in depth: scan the serialised result for the body marker.
      expect(JSON.stringify(result)).not.toContain(
        'FULL_BODY_THAT_MUST_NOT_LEAK',
      );
    });

    it('drops the snippet (canShowSnippet gate) for a page the caller cannot view but still returns the hit', async () => {
      // ownedByOtherPage is GRANT_OWNER owned by userB. The dummy delegator
      // returns it verbatim (no filterPagesByViewer), so it reaches
      // formatSearchResult, where canShowSnippet returns false for userA and
      // nulls the snippet — the hit is kept, the body fragment is not exposed.
      const pageId = ownedByOtherPage._id.toString();
      const delegator = buildDummyFullTextDelegator(() =>
        Promise.resolve({
          data: [
            {
              _id: pageId,
              _score: 1,
              _source: {
                path: ownedByOtherPage.path,
                body: 'FULL_BODY_THAT_MUST_NOT_LEAK',
              },
              _highlight: { 'body.ja': ['<em>secret</em> fragment'] },
            },
          ],
          meta: { total: 1, hitsCount: 1 },
        }),
      );
      installDelegator(delegator);

      const result = await invokeExecute(
        { query: 'anything', limit: 20 },
        buildRequestContext(userA),
      );

      assertOk(result);
      expect(result.hits).toHaveLength(1);
      expect(result.hits[0]).toStrictEqual({
        pageId,
        pagePath: ownedByOtherPage.path,
      });
      expect(result.hits[0].snippet).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('secret');
    });

    it("returns { result: 'ok', hits: [], totalCount: 0 } when delegator returns no hits", async () => {
      installDelegator(buildDummyFullTextDelegator());

      const result = await invokeExecute(
        { query: 'anything', limit: 20 },
        buildRequestContext(userA),
      );

      assertOk(result);
      expect(result.hits).toEqual([]);
      expect(result.totalCount).toBe(0);
    });
  });

  describe('userGroups resolved from real MongoDB', () => {
    it('forwards the calling user and Mongo-resolved userGroups to delegator.search', async () => {
      const delegator = buildDummyFullTextDelegator();
      installDelegator(delegator);

      await invokeExecute(
        { query: 'anything', limit: 20 },
        buildRequestContext(userA),
      );

      expect(delegator.search).toHaveBeenCalledTimes(1);
      const callArgs = delegator.search.mock.calls[0];
      // delegator.search(data, user, userGroups, opts) — assert positional
      // arity AND identity for the user argument (must pass through by
      // reference; no synthetic re-creation).
      expect(callArgs[1]).toBe(userA);
      // userGroups is the 3rd positional arg. It must contain the real Mongo
      // _id of group G (resolved via UserGroupRelation.findAllUserGroupIdsRelatedToUser).
      const userGroupsArg = callArgs[2] as unknown[];
      expect(Array.isArray(userGroupsArg)).toBe(true);
      const idStrings = userGroupsArg.map((id) => String(id));
      expect(idStrings).toContain(groupG._id.toString());
    });
  });

  describe('failure handling', () => {
    it("returns { result: 'error' } when the delegator rejects (does not rethrow)", async () => {
      const delegator = buildDummyFullTextDelegator(() =>
        Promise.reject(new Error('synthetic ES failure')),
      );
      installDelegator(delegator);

      const result = await invokeExecute(
        { query: 'anything', limit: 20 },
        buildRequestContext(userA),
      );

      assertFailure(result);
      expect(result.result).toBe('error');
      expect(result.reason.length).toBeGreaterThan(0);
    });
  });

  describe('sort / order pass-through (requirement 6.9)', () => {
    it('forwards sort and order to delegator.search via searchOpts', async () => {
      const delegator = buildDummyFullTextDelegator();
      installDelegator(delegator);

      await invokeExecute(
        { query: 'anything', limit: 5, sort: 'updatedAt', order: 'desc' },
        buildRequestContext(userA),
      );

      expect(delegator.search).toHaveBeenCalledTimes(1);
      // delegator.search(data, user, userGroups, opts) — opts is the 4th arg.
      // Narrow to the keys the tool is responsible for forwarding; ignore any
      // extra keys (e.g. `vector`) that SearchService.searchKeyword may inject.
      const opts = delegator.search.mock.calls[0][3] as {
        sort?: string;
        order?: string;
        limit?: number;
      };
      expect(opts.sort).toBe('updatedAt');
      expect(opts.order).toBe('desc');
      expect(opts.limit).toBe(5);
    });
  });
});
