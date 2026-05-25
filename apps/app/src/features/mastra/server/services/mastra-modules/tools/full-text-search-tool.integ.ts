import type { IUserHasId } from '@growi/core';
import { RequestContext } from '@mastra/core/request-context';
import mongoose, { type Model } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type { ISearchResult, ISearchResultData } from '~/interfaces/search';
import type Crowi from '~/server/crowi';
import type { QueryTerms, SearchDelegator } from '~/server/interfaces/search';
import SearchService from '~/server/service/search';

import type { MastraRequestContextShape } from '../types/request-context';
import { fullTextSearchTool } from './full-text-search-tool';

// 本テストは **real Elasticsearch には接続しない**。理由:
// 1. リポジトリ既存の `apps/app/src/server/service/search/search-service.integ.ts` は
//    `dummyFullTextSearchDelegator` を `searchService.nqDelegators` に注入する形を取って
//    おり、本 spec はその慣例に従う。
// 2. GitHub Actions の通常 test job (`pnpm run test` を回す workflow) には
//    `services.elasticsearch` が定義されていない (定義されているのは
//    `reusable-app-prod.yml` の production build/launch のみ)。実 ES に接続する integ
//    test はリポジトリ初の試みになり、CI 不安定化や workflow 改修コストを払うに見合わない。
// 3. ES の query DSL / `filterPagesByViewer` の grant 適用ロジックは **本 spec の責任範囲外**
//    (`SearchService` / `ElasticsearchDelegator` 側の責務)。本 tool の test 価値は
//    「tool layer から SearchService への引数渡しと戻り値 mapping」に絞る。
//
// 何が test できなくなるか:
// - 実 ES での grant 反映の動作確認 (上記の通り別 layer の責任)
// - ES query DSL の組み立て (同上)
//
// 何は維持されるか:
// - tool が `SearchService.searchKeyword` を呼ぶ際の引数 (query / null / user / userGroups / searchOpts)
// - 実 MongoDB 上の `UserGroupRelation` を経由して `userGroups` が解決されること
// - dummy delegator の戻り値を tool が `{ pageId, pagePath, snippet }` 形に正しく mapping すること
// - 失敗ケース (delegator が reject) で `result: 'error'` を返すこと

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

  let userA: IUserHasId;
  let groupG: { _id: mongoose.Types.ObjectId };

  beforeAll(async () => {
    crowi = await getInstance();
    searchService = new SearchService(crowi);

    // The real SearchService constructor short-circuits its delegator setup
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

    const userAName = `agentic-search-integ-userA-${WORKER_ID}`;
    await User.deleteMany({ username: userAName });
    const insertedUsers = await User.insertMany([
      {
        name: userAName,
        username: userAName,
        email: `${userAName}@example.com`,
      },
    ]);
    userA = insertedUsers[0];

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
  });

  afterAll(async () => {
    // Best-effort cleanup of the Mongo fixtures created above. Tolerate
    // failures so cleanup never masks assertion failures.
    try {
      await UserGroupRelation.deleteMany({ relatedGroup: groupG?._id });
      await UserGroup.deleteMany({ _id: groupG?._id });
      await User.deleteMany({ _id: userA?._id });
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
      const pageId = new mongoose.Types.ObjectId().toString();
      const pagePath = `/agentic-search-integ/${WORKER_ID}/mapped`;
      const snippet = '<em>match</em> highlighted body';
      // `body` is intentionally included in `_source` to verify the tool
      // strips it before returning — see requirement 6.5 (body retrieval
      // belongs to getPageContentTool, not this tool).
      const delegator = buildDummyFullTextDelegator(() =>
        Promise.resolve({
          data: [
            {
              _id: pageId,
              _score: 1,
              _source: {
                path: pagePath,
                body: 'FULL_BODY_THAT_MUST_NOT_LEAK',
              },
              _highlight: { body: [snippet] },
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
      // `_score`, ...) must leak through.
      expect(result.hits[0]).toStrictEqual({ pageId, pagePath, snippet });
      // Defence in depth: scan the serialised result for the body marker.
      expect(JSON.stringify(result)).not.toContain(
        'FULL_BODY_THAT_MUST_NOT_LEAK',
      );
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
