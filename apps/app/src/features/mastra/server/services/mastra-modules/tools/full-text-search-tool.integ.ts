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

// This integration test drives the tool against a REAL Elasticsearch — the same
// engine production uses — so that the highlight-field naming and grant
// enforcement it depends on are exercised end-to-end (the dummy-delegator
// version this replaces could verify neither):
//   - `body.ja` / `body.en` highlight generation for a plain keyword match, and
//     therefore that a snippet actually reaches the agent (the bug this suite
//     was rewritten to catch — the old code read only `_highlight.body`).
//   - `filterPagesByViewer` result-level grant filtering on a real index
//     (GRANT_RESTRICTED never surfaces).
//   - The `canShowSnippet` visibility gate for a page the caller cannot view but
//     that still appears in results (GRANT_OWNER owned by another user, under
//     the default list-policy) — the hit is kept, the body fragment is dropped.
//
// Elasticsearch wiring (mirrors src/server/service/search-delegator/
// elasticsearch.integ.ts): ELASTICSEARCH_URI is mapped from
// VITE_ELASTICSEARCH_URI by test/setup/elasticsearch.ts. The `ci-app.yml`
// `ci-app-test-integration` job provisions ES 8 and 9, so this runs in CI;
// `describe.skipIf` degrades gracefully in local environments without ES.
//
// Index isolation: the app-integration project runs files in parallel forks
// against ONE shared ES server, and elasticsearch.integ.ts rebuilds (deletes +
// recreates) the default `growi` index. To avoid being clobbered, this suite
// overrides `app:elasticsearchUri` to a dedicated per-worker index for the
// duration of the file and restores it afterwards.

vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';

// ELASTICSEARCH_URI is mapped from VITE_ELASTICSEARCH_URI by
// test/setup/elasticsearch.ts. Skip the whole suite when ES is not configured.
const hasElasticsearch = !!process.env.ELASTICSEARCH_URI;

// Unique per worker AND per run so a crashed prior run's leftover documents (in
// the persistent devcontainer ES) can never match this run's queries. Must be
// ALPHABETIC only: the ES tokenizer splits a mixed alphanumeric string on the
// letter↔digit boundary (e.g. `probe123` → `probe` + `123`), which would break
// the search term into pieces and let unrelated tokens collide on the digits.
const digitsToAlpha = (s: string): string =>
  s.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
const RUN_TOKEN = digitsToAlpha(`${WORKER_ID}${Date.now()}`);

const PUBLIC_TOKEN = `zzprobepublic${RUN_TOKEN}`;
const OWNER_TOKEN = `zzprobeowner${RUN_TOKEN}`;
const RESTRICTED_TOKEN = `zzproberestricted${RUN_TOKEN}`;
const MISSING_TOKEN = `zzprobemissing${RUN_TOKEN}`;

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
// `as never` args are unavoidable: Mastra's `execute` signature uses `unknown`
// for both input and the context envelope. Narrowing the return shape once here
// keeps every call site cast-free.
const invokeExecute = async (
  inputData: { query: string; limit?: number },
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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe.skipIf(!hasElasticsearch)(
  'fullTextSearchTool (integration, real Elasticsearch)',
  () => {
    let crowi: Crowi;
    let searchService: SearchService;
    let User: Model<IUserHasId>;
    let Page: PageModel;
    let Revision: Model<{
      pageId: mongoose.Types.ObjectId;
      body: string;
      format: string;
      author: mongoose.Types.ObjectId;
    }>;

    let userA: IUserHasId;
    let userB: IUserHasId;

    // `id` is captured from the generated ObjectId (always defined), avoiding
    // PageDocument._id's `possibly undefined` type; `page` is kept for ES cleanup.
    type Seeded = { page: PageDocument; id: string; path: string };
    let publicSeed: Seeded;
    let ownerSeed: Seeded;
    let restrictedSeed: Seeded;

    let originalEsUri: string | undefined;

    const buildRequestContext = (
      user: IUserHasId,
    ): RequestContext<MastraRequestContextShape> => {
      const ctx = new RequestContext<MastraRequestContextShape>();
      ctx.set('user', user);
      ctx.set('searchService', searchService);
      return ctx;
    };

    const runTool = (
      query: string,
      user: IUserHasId,
    ): Promise<FullTextSearchResult> =>
      invokeExecute({ query, limit: 20 }, buildRequestContext(user));

    // Create a page with a linked revision whose body carries `token`. A
    // revision is mandatory: aggregatePipelineToIndex `$unwind`s revision, so a
    // page without one is never indexed.
    const seedPage = async (opts: {
      path: string;
      grant: number;
      creator: IUserHasId;
      token: string;
      grantedUsers?: string[];
    }): Promise<Seeded> => {
      const { path, grant, creator, token, grantedUsers = [] } = opts;
      const pageId = new mongoose.Types.ObjectId();
      const [revision] = await Revision.insertMany([
        {
          pageId,
          body: `This page mentions ${token} in its content.`,
          format: 'markdown',
          author: creator._id,
        },
      ]);
      const [page] = await Page.insertMany([
        {
          _id: pageId,
          path,
          grant,
          creator: creator._id,
          lastUpdateUser: creator._id,
          grantedUsers,
          grantedGroups: [],
          revision: revision._id,
        },
      ]);
      await searchService.fullTextSearchDelegator.syncPageUpdated(
        page,
        creator,
      );
      return { page, id: pageId.toString(), path };
    };

    // Elasticsearch refreshes newly-indexed documents asynchronously (~1s). Poll
    // through the tool until the public page becomes searchable so that every
    // test below observes a fully-refreshed index.
    const waitUntilSearchable = async (): Promise<void> => {
      for (let attempt = 0; attempt < 40; attempt++) {
        // Sequential by design: each poll must observe the result of the last.
        // biome-ignore lint: intentional polling loop
        const result = await runTool(PUBLIC_TOKEN, userA);
        if (result.result === 'ok' && result.hits.length > 0) {
          return;
        }
        // biome-ignore lint: intentional polling backoff
        await sleep(500);
      }
      throw new Error(
        'Seeded pages did not become searchable within the timeout',
      );
    };

    beforeAll(async () => {
      crowi = await getInstance();

      // Point the search delegator at a dedicated per-worker index so a parallel
      // elasticsearch.integ.ts rebuild of the shared `growi` index cannot delete
      // these documents mid-test. Reuse the HOST from the environment-provided
      // URI (elasticsearch:9200 in the devcontainer, localhost:9200 in CI) and
      // swap ONLY the index name — hardcoding the host breaks CI DNS.
      originalEsUri = process.env.ELASTICSEARCH_URI;
      if (originalEsUri == null) {
        throw new Error('ELASTICSEARCH_URI must be set to run this suite');
      }
      const dedicatedUri = new URL(originalEsUri);
      dedicatedUri.pathname = `/growi_ftstool_${WORKER_ID}`;
      process.env.ELASTICSEARCH_URI = dedicatedUri.href;
      await configManager.loadConfigs();

      searchService = await SearchService.create(crowi);

      User = mongoose.model<IUserHasId>('User');
      Page = mongoose.model<PageDocument, PageModel>('Page');
      Revision = mongoose.model('Revision');

      const userAName = `agentic-search-realint-userA-${WORKER_ID}`;
      const userBName = `agentic-search-realint-userB-${WORKER_ID}`;
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

      const publicPath = `/agentic-search-realint/${RUN_TOKEN}/public`;
      const ownedByOtherPath = `/agentic-search-realint/${RUN_TOKEN}/owned-by-other`;
      const restrictedPath = `/agentic-search-realint/${RUN_TOKEN}/restricted`;
      await Page.deleteMany({
        path: { $in: [publicPath, ownedByOtherPath, restrictedPath] },
      });

      publicSeed = await seedPage({
        path: publicPath,
        grant: Page.GRANT_PUBLIC,
        creator: userA,
        token: PUBLIC_TOKEN,
      });
      // GRANT_OWNER owned by userB. Under the default list-policy
      // (hideRestrictedByOwner=false) filterPagesByViewer still returns it to
      // userA, so it reaches the canShowSnippet gate.
      ownerSeed = await seedPage({
        path: ownedByOtherPath,
        grant: Page.GRANT_OWNER,
        creator: userB,
        token: OWNER_TOKEN,
        grantedUsers: [userB._id],
      });
      // GRANT_RESTRICTED is never added by filterPagesByViewer for anyone.
      restrictedSeed = await seedPage({
        path: restrictedPath,
        grant: Page.GRANT_RESTRICTED,
        creator: userA,
        token: RESTRICTED_TOKEN,
      });

      await waitUntilSearchable();
    }, 90_000);

    afterAll(async () => {
      // Best-effort cleanup. Tolerate failures so cleanup never masks assertions.
      const seeds = [publicSeed, ownerSeed, restrictedSeed].filter(Boolean);
      const seedIds = seeds.map((s) => s.id);
      try {
        await searchService?.fullTextSearchDelegator?.deletePages(
          seeds.map((s) => s.page),
        );
      } catch {
        // ignore
      }
      try {
        await Page?.deleteMany({ _id: { $in: seedIds } });
        await Revision?.deleteMany({ pageId: { $in: seedIds } });
        await User?.deleteMany({ _id: { $in: [userA?._id, userB?._id] } });
      } catch {
        // ignore
      }

      // Restore the shared index URI for any sibling file reusing this fork.
      if (originalEsUri == null) {
        delete process.env.ELASTICSEARCH_URI;
      } else {
        process.env.ELASTICSEARCH_URI = originalEsUri;
      }
      await configManager.loadConfigs();
    });

    it('returns a snippet for a plain keyword match on a public page (body.ja / body.en highlight)', async () => {
      const result = await runTool(PUBLIC_TOKEN, userA);

      assertOk(result);
      const hit = result.hits.find((h) => h.pageId === publicSeed.id);
      expect(hit).toBeDefined();
      expect(hit?.pagePath).toBe(publicSeed.path);
      // The snippet is the ES highlight fragment: it wraps the matched token in
      // <em> and contains the token text. This is the core regression guard —
      // the previous implementation read the wrong highlight key and dropped it.
      expect(hit?.snippet).toContain('<em');
      // Assert on the stable prefix, not the full token, so analyzer stemming of
      // the run suffix cannot make this brittle.
      expect(hit?.snippet?.toLowerCase()).toContain('zzprobepublic');
      // The hit must expose ONLY these keys — no page document / body leak.
      expect(Object.keys(hit ?? {}).sort()).toEqual([
        'pageId',
        'pagePath',
        'snippet',
      ]);
    }, 30_000);

    it('drops the snippet (canShowSnippet gate) for a GRANT_OWNER page owned by another user, while still returning the hit', async () => {
      const result = await runTool(OWNER_TOKEN, userA);

      assertOk(result);
      const hit = result.hits.find((h) => h.pageId === ownerSeed.id);
      // filterPagesByViewer keeps it (default policy), but the snippet is nulled.
      expect(hit).toBeDefined();
      expect(hit?.pagePath).toBe(ownerSeed.path);
      expect(hit?.snippet).toBeUndefined();
      // No body fragment of the unviewable page leaks anywhere in the payload.
      expect(JSON.stringify(result)).not.toContain(OWNER_TOKEN);
    }, 30_000);

    it('excludes a GRANT_RESTRICTED page from results (filterPagesByViewer)', async () => {
      const result = await runTool(RESTRICTED_TOKEN, userA);

      assertOk(result);
      // The page is indexed the same way as the ones found above, so an empty
      // result is due to grant filtering, not an indexing miss.
      expect(result.hits.some((h) => h.pageId === restrictedSeed.id)).toBe(
        false,
      );
    }, 30_000);

    it('returns an empty hit list when nothing matches', async () => {
      const result = await runTool(MISSING_TOKEN, userA);

      assertOk(result);
      expect(result.hits).toEqual([]);
      expect(result.totalCount).toBe(0);
    }, 30_000);
  },
);
