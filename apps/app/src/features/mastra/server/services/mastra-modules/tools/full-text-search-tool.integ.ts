import type { IUserHasId } from '@growi/core';
import { RequestContext } from '@mastra/core/request-context';
import mongoose, { type Model } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import SearchService from '~/server/service/search';

import type { MastraRequestContextShape } from '../types/request-context';
import { fullTextSearchTool } from './full-text-search-tool';

// Integration test for the Mastra full-text search tool.
//
// Approach (chosen: A): real MongoDB + real Elasticsearch + real SearchService.
//
// The devcontainer exposes Elasticsearch at http://elasticsearch:9200 and the
// integration test runner provides a per-worker MongoDB instance. We bootstrap
// a Crowi singleton, override `app:elasticsearchUri` to a unique per-run index
// to avoid colliding with the developer's `/growi` data, then exercise the
// tool against a small fixture of pages with different grant policies.

// Suppress logger noise from the tool body itself.
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

// Unique index name per test run to avoid cross-talk with developer data.
// Workers in Vitest may run in parallel — include VITEST_WORKER_ID.
const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const TEST_INDEX_NAME = `agentic-search-int-${WORKER_ID}-${Date.now()}`;
const TEST_ES_HOST = 'http://elasticsearch:9200';
const TEST_ES_URI = `${TEST_ES_HOST}/${TEST_INDEX_NAME}`;

// Helper to wait for ES refresh after a bulk index write.
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

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

// Helper to invoke the tool's execute the same way the Mastra runtime does.
// Narrow the return shape ONCE here so callers can branch on `result.result`
// without per-call casts. The two `as never` args are unavoidable: Mastra's
// `execute` signature uses `unknown` for both input and the context envelope.
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

// Asserts the tool returned a success result and narrows the static type to
// `FullTextSearchOkResult`. Replaces the per-call `as FullTextSearchOkResult`
// cast at every call site with a single typed assertion that also fails the
// test if the tool returned an error envelope (which would otherwise mask the
// real failure as an "undefined hits" error downstream).
function assertOk(
  result: FullTextSearchResult,
): asserts result is FullTextSearchOkResult {
  expect(result.result).toBe('ok');
}

// Unique token used across page bodies to scope the test query and ensure we
// only match pages this suite created (no developer / migration data drift).
const SCOPE_TOKEN = `agenticSearchIntegMarker${WORKER_ID}xyz`;

describe('fullTextSearchTool (integration)', () => {
  let crowi: Crowi;
  let searchService: SearchService;
  let Page: PageModel;
  let User: Model<IUserHasId>;
  let Revision: Model<{
    pageId: mongoose.Types.ObjectId;
    body: string;
    format: string;
    author: mongoose.Types.ObjectId;
  }>;
  let UserGroup: Model<{ name: string }>;
  let UserGroupRelation: Model<{
    relatedGroup: mongoose.Types.ObjectId;
    relatedUser: mongoose.Types.ObjectId;
  }>;

  let userA: IUserHasId;
  let userB: IUserHasId;
  let groupG: { _id: mongoose.Types.ObjectId };

  const pagePathPublic = `/agentic-search-integ/${WORKER_ID}/public`;
  const pagePathOwner = `/agentic-search-integ/${WORKER_ID}/owner`;
  const pagePathGroup = `/agentic-search-integ/${WORKER_ID}/group`;

  beforeAll(async () => {
    // The ES delegator reads `app:elasticsearchUri` at construction time.
    // We must set the env var BEFORE Crowi loads configs the first time so
    // that the singleton SearchService picks it up.
    process.env.ELASTICSEARCH_URI = TEST_ES_URI;
    process.env.ELASTICSEARCH_VERSION =
      process.env.ELASTICSEARCH_VERSION ?? '9';

    crowi = await getInstance();

    // Reload configs in case getInstance() ran earlier in the worker without
    // ES set. updateConfig() persists to Mongo and triggers reload.
    await configManager.loadConfigs();

    // Grant filter at the ES delegator level needs these flags so the search
    // query actually narrows by viewer. Defaults are `false` (show all),
    // which would make every GRANT_OWNER / GRANT_USER_GROUP page visible to
    // any logged-in user — defeating the purpose of this test.
    await configManager.updateConfig(
      'security:list-policy:hideRestrictedByOwner',
      true,
      { skipPubsub: true },
    );
    await configManager.updateConfig(
      'security:list-policy:hideRestrictedByGroup',
      true,
      { skipPubsub: true },
    );

    searchService = new SearchService(crowi);

    if (searchService.isElasticsearchEnabled !== true) {
      throw new Error(
        'Elasticsearch is not enabled despite explicit ELASTICSEARCH_URI; aborting integration test setup.',
      );
    }

    // SearchService.constructor fires `fullTextSearchDelegator.init()` as
    // fire-and-forget. Wait until the delegator has fully initialised the
    // ES client + index + alias by polling `getInfoForHealth`. We must NOT
    // call init() again ourselves — that would race the constructor and
    // throw `resource_already_exists_exception` from createIndex.
    const initDeadline = Date.now() + 30_000;
    let lastErr: unknown;
    while (Date.now() < initDeadline) {
      try {
        await searchService.getInfoForHealth();
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        await sleep(200);
      }
    }
    if (lastErr != null) {
      throw new Error(
        `Failed to reach Elasticsearch during init: ${
          lastErr instanceof Error ? lastErr.message : String(lastErr)
        }`,
      );
    }

    // Make sure the index actually exists (the alias too) before we attempt
    // to bulk write. The constructor's init() calls normalizeIndices() which
    // creates both — wait for it by polling indices.exists.
    // The ES delegator's `client` field is not in any exported type; the
    // ES SDK itself is also `unknown`-shaped for our purposes here. Narrow
    // to the minimal `indices.exists` surface we actually call.
    type EsIndicesClient = {
      indices: { exists: (args: { index: string }) => Promise<unknown> };
    };
    const esClient = (
      searchService.fullTextSearchDelegator as unknown as {
        client: EsIndicesClient;
      }
    ).client;
    // The ES JS SDK returns either a boolean (v8 transport) or a wrapper
    // `{ body: boolean }` (older transport). Narrow via predicate to avoid
    // any cast at the check site.
    const isExistsTrue = (v: unknown): boolean => {
      if (v === true) return true;
      if (v != null && typeof v === 'object' && 'body' in v) {
        return (v as { body: unknown }).body === true;
      }
      return false;
    };
    const indexReadyDeadline = Date.now() + 30_000;
    while (Date.now() < indexReadyDeadline) {
      const exists = await esClient.indices.exists({ index: TEST_INDEX_NAME });
      if (isExistsTrue(exists)) {
        break;
      }
      await sleep(200);
    }

    // `mongoose.model(name)` without generics returns `Model<any>`. Passing
    // the declared document shape via the generic narrows it to the matching
    // `Model<T>` for User/Revision/UserGroup/UserGroupRelation without per-
    // call casts. Page keeps its existing `<PageDocument, PageModel>` form
    // because its schema methods are typed on `PageModel`.
    type RevisionDoc = {
      pageId: mongoose.Types.ObjectId;
      body: string;
      format: string;
      author: mongoose.Types.ObjectId;
    };
    type UserGroupRelationDoc = {
      relatedGroup: mongoose.Types.ObjectId;
      relatedUser: mongoose.Types.ObjectId;
    };
    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model<IUserHasId>('User');
    Revision = mongoose.model<RevisionDoc>('Revision');
    UserGroup = mongoose.model<{ name: string }>('UserGroup');
    UserGroupRelation =
      mongoose.model<UserGroupRelationDoc>('UserGroupRelation');

    // Users: A and B (both real Mongo documents).
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
    // `User` is typed as `Model<IUserHasId>`, so insertMany returns
    // `(IUserHasId & Document)[]` — already assignable to IUserHasId.
    userA = insertedUsers[0];
    userB = insertedUsers[1];

    // Group containing only user A.
    const groupName = `agentic-search-integ-group-${WORKER_ID}`;
    await UserGroup.deleteMany({ name: groupName });
    const insertedGroup = await UserGroup.create({ name: groupName });
    // Mongoose's `Document._id` is typed as `unknown` from Model.create's
    // return shape; narrow to ObjectId via a single, scoped cast (the schema
    // guarantees this; we only use _id below).
    groupG = { _id: insertedGroup._id as mongoose.Types.ObjectId };
    await UserGroupRelation.deleteMany({ relatedGroup: groupG._id });
    await UserGroupRelation.create({
      relatedGroup: groupG._id,
      relatedUser: userA._id,
    });

    // Clean any prior pages with the same paths (idempotency under reruns).
    await Page.deleteMany({
      path: { $in: [pagePathPublic, pagePathOwner, pagePathGroup] },
    });

    // Create pages first to get _ids, then create revisions and link them.
    const publicPage = await Page.create({
      path: pagePathPublic,
      grant: Page.GRANT_PUBLIC,
      creator: userA._id,
      lastUpdateUser: userA._id,
    });
    const ownerPage = await Page.create({
      path: pagePathOwner,
      grant: Page.GRANT_OWNER,
      grantedUsers: [userA._id],
      creator: userA._id,
      lastUpdateUser: userA._id,
    });
    const groupPage = await Page.create({
      path: pagePathGroup,
      grant: Page.GRANT_USER_GROUP,
      grantedUsers: [],
      grantedGroups: [{ item: groupG._id, type: 'UserGroup' }],
      creator: userA._id,
      lastUpdateUser: userA._id,
    });

    const revisions = await Revision.insertMany([
      {
        pageId: publicPage._id,
        body: `Public page body ${SCOPE_TOKEN} hello world`,
        format: 'markdown',
        author: userA._id,
      },
      {
        pageId: ownerPage._id,
        body: `Owner page body ${SCOPE_TOKEN} hello world`,
        format: 'markdown',
        author: userA._id,
      },
      {
        pageId: groupPage._id,
        body: `Group page body ${SCOPE_TOKEN} hello world`,
        format: 'markdown',
        author: userA._id,
      },
    ]);

    publicPage.revision = revisions[0]._id;
    ownerPage.revision = revisions[1]._id;
    groupPage.revision = revisions[2]._id;
    await publicPage.save();
    await ownerPage.save();
    await groupPage.save();

    // Backdate one page's `updatedAt` so two pages visible to userA differ on
    // the `updatedAt` axis. We backdate the OWNER page (visible only to A) to
    // 7 days ago; the PUBLIC page keeps its fresh `Date.now()` default. This
    // gives the sort-by-updatedAt integration test below two same-query hits
    // with deterministically different timestamps.
    //
    // Page schema disables Mongoose's `timestamps.updatedAt` (see
    // server/models/page.ts:266), so a direct $set on `updatedAt` is the
    // canonical way to control its value without bypassing other middleware.
    // ElasticsearchDelegator indexes `page.updatedAt` into the ES `updated_at`
    // field (server/service/search-delegator/elasticsearch.ts:480-481), so the
    // backdate must happen BEFORE the bulk index call below.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await Page.findByIdAndUpdate(ownerPage._id, {
      $set: { updatedAt: sevenDaysAgo },
    });

    // Index our three pages into ES.
    await searchService.fullTextSearchDelegator.updateOrInsertPages(() =>
      Page.find({
        path: { $in: [pagePathPublic, pagePathOwner, pagePathGroup] },
      }),
    );

    // Wait for ES to refresh; the delegator's bulk write does not request
    // refresh. ES default refresh_interval is 1s — wait 2s to be safe.
    await sleep(2000);
  }, 60_000);

  afterAll(async () => {
    // Best-effort teardown: delete pages, revisions, group, users and the ES
    // index. Tolerate failures (e.g. ES already gone) so cleanup never masks
    // assertion failures.
    try {
      await Page.deleteMany({
        path: { $in: [pagePathPublic, pagePathOwner, pagePathGroup] },
      });
      await UserGroupRelation.deleteMany({ relatedGroup: groupG?._id });
      await UserGroup.deleteMany({ _id: groupG?._id });
      await User.deleteMany({ _id: { $in: [userA?._id, userB?._id] } });
    } catch {
      // ignore
    }

    try {
      // Tear down the unique ES index for this run.
      // The delegator's `client` field is not in any exported type; narrow
      // to the minimal `indices.{delete,deleteAlias}` surface we actually use
      // for teardown. `deleteAlias` is optional in some SDK versions.
      type EsTeardownClient = {
        indices: {
          delete: (args: { index: string }) => Promise<unknown>;
          deleteAlias?: (args: {
            index: string;
            name: string;
          }) => Promise<unknown>;
        };
      };
      const delegator = searchService?.fullTextSearchDelegator as unknown as
        | { client?: EsTeardownClient }
        | undefined;
      const client = delegator?.client;
      if (client != null) {
        const aliasName = `${TEST_INDEX_NAME}-alias`;
        await client.indices
          .delete({ index: TEST_INDEX_NAME })
          .catch(() => undefined);
        await client.indices
          .delete({ index: `${TEST_INDEX_NAME}-tmp` })
          .catch(() => undefined);
        // best-effort alias removal; if the alias does not exist the call
        // throws, which we swallow.
        await client.indices
          .deleteAlias?.({
            index: TEST_INDEX_NAME,
            name: aliasName,
          })
          .catch(() => undefined);
      }
    } catch {
      // ignore
    }
  }, 30_000);

  const buildRequestContext = (
    user: IUserHasId,
  ): RequestContext<MastraRequestContextShape> => {
    const ctx = new RequestContext<MastraRequestContextShape>();
    ctx.set('user', user);
    ctx.set('searchService', searchService);
    return ctx;
  };

  describe('grant scenarios via real Elasticsearch', () => {
    it('returns the GRANT_PUBLIC page to both user A and user B', async () => {
      const resultForA = await invokeExecute(
        { query: SCOPE_TOKEN, limit: 20 },
        buildRequestContext(userA),
      );
      const resultForB = await invokeExecute(
        { query: SCOPE_TOKEN, limit: 20 },
        buildRequestContext(userB),
      );

      assertOk(resultForA);
      assertOk(resultForB);

      const pathsForA = resultForA.hits.map((h) => h.pagePath);
      const pathsForB = resultForB.hits.map((h) => h.pagePath);

      expect(pathsForA).toContain(pagePathPublic);
      expect(pathsForB).toContain(pagePathPublic);
    });

    it('returns the GRANT_OWNER page to its owner (A) but not to a non-owner (B)', async () => {
      const resultForA = await invokeExecute(
        { query: SCOPE_TOKEN, limit: 20 },
        buildRequestContext(userA),
      );
      const resultForB = await invokeExecute(
        { query: SCOPE_TOKEN, limit: 20 },
        buildRequestContext(userB),
      );

      assertOk(resultForA);
      assertOk(resultForB);

      const pathsForA = resultForA.hits.map((h) => h.pagePath);
      const pathsForB = resultForB.hits.map((h) => h.pagePath);

      expect(pathsForA).toContain(pagePathOwner);
      expect(pathsForB).not.toContain(pagePathOwner);
    });

    it('returns the GRANT_USER_GROUP page to a member (A) but not to a non-member (B)', async () => {
      const resultForA = await invokeExecute(
        { query: SCOPE_TOKEN, limit: 20 },
        buildRequestContext(userA),
      );
      const resultForB = await invokeExecute(
        { query: SCOPE_TOKEN, limit: 20 },
        buildRequestContext(userB),
      );

      assertOk(resultForA);
      assertOk(resultForB);

      const pathsForA = resultForA.hits.map((h) => h.pagePath);
      const pathsForB = resultForB.hits.map((h) => h.pagePath);

      // A is a member of group G; the page is granted to G.
      expect(pathsForA).toContain(pagePathGroup);
      // B is not a member of any group that owns the page.
      expect(pathsForB).not.toContain(pagePathGroup);
    });
  });

  describe('sort / order (requirement 6.9)', () => {
    it('returns the more recently updated page first when sort: updatedAt + order: desc', async () => {
      // Both PUBLIC and OWNER pages match SCOPE_TOKEN and are visible to A.
      // OWNER's `updatedAt` was backdated to 7 days ago in beforeAll; PUBLIC's
      // is fresh. With sort: updatedAt + order: desc the PUBLIC page (newer)
      // must appear BEFORE the OWNER page (older) in the hits array.
      const result = await invokeExecute(
        { query: SCOPE_TOKEN, limit: 20, sort: 'updatedAt', order: 'desc' },
        buildRequestContext(userA),
      );

      assertOk(result);

      const paths = result.hits.map((h) => h.pagePath);
      // Sanity: both pages are present so the ordering assertion is meaningful.
      expect(paths).toContain(pagePathPublic);
      expect(paths).toContain(pagePathOwner);

      const publicIdx = paths.indexOf(pagePathPublic);
      const ownerIdx = paths.indexOf(pagePathOwner);
      expect(publicIdx).toBeLessThan(ownerIdx);
    });
  });

  describe('no-hit query', () => {
    it("returns { result: 'ok', hits: [], totalCount: 0 } when nothing matches", async () => {
      // A single nonsense alphabetical token. The kuromoji tokenizer used by
      // the `japanese` analyzer splits on digit boundaries (e.g. it would
      // pull out `1` from `…1…` and that digit token then matches the path
      // segment `/…/1/…` in our fixtures), and `_` / `-` would let the
      // standard analyzer split into common subtokens that hit dev data.
      // Keep the query as a single pure-alpha word so it cannot tokenise
      // into anything indexed.
      const result = await invokeExecute(
        {
          query: 'zqxwcevbnmasdfghjklpoiuytrewqq',
          limit: 20,
        },
        buildRequestContext(userA),
      );

      assertOk(result);
      expect(result.hits).toEqual([]);
      expect(result.totalCount).toBe(0);
    });
  });
});
