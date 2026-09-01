import type { IUserHasId } from '@growi/core';
import { escapeStringForMongoRegex } from '@growi/core/dist/utils';
import type { Document } from 'mongodb';
import mongoose, { type Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type { PageDocument, PageModel } from '~/server/models/page';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';
import { prisma } from '~/utils/prisma';

import { buildVisibleSourcesQuery, findBacklinks } from './find-backlinks';
import { syncOutboundLinks } from './page-link-sync';

const PAGELINKS_COLLECTION = 'pagelinks';

/**
 * Raw driver handle — for the perf-critical bulk inserts and the collection-level
 * inspection (indexes, explain) that need to bypass both ORMs.
 */
const rawPagelinksCollection = () => {
  const db = mongoose.connection.db;
  if (db == null) throw new Error('no mongoose connection');
  return db.collection(PAGELINKS_COLLECTION);
};

/**
 * The commands `fn` actually sent to the `pagelinks` collection, read off the database
 * profiler.
 *
 * The plan and scoping assertions below are only worth anything if they describe the
 * command *production* issues. A transcribed copy silently stops tracking the real one
 * (it did exactly that when findBacklinkSources moved to Prisma), and a spy cannot reach
 * the extension's closure-captured client. Observing the wire cannot drift.
 */
const capturePagelinkCommands = async (
  fn: () => Promise<unknown>,
): Promise<Document[]> => {
  const db = mongoose.connection.db;
  if (db == null) throw new Error('no mongoose connection');

  const since = new Date();
  await db.command({ profile: 2 });
  try {
    await fn();
  } finally {
    await db.command({ profile: 0 });
  }

  return db
    .collection('system.profile')
    .find({
      ts: { $gte: since },
      ns: `${db.databaseName}.${PAGELINKS_COLLECTION}`,
    })
    .sort({ ts: 1 })
    .toArray();
};

/** Strip the session/routing envelope so a captured command can be fed back to `explain`. */
const explainable = (command: Document): Document =>
  Object.fromEntries(
    Object.entries(command).filter(
      ([key]) => !key.startsWith('$') && key !== 'lsid',
    ),
  );

/*
 * B2.1 — read-path benchmark for backlinks retrieval at scale (requirement 3.4).
 *
 * A measurement exercise, not a feature test: it seeds a ~100k-page dataset with a
 * heavily-linked hub page and measures the real `findBacklinks` path for that hub
 * page as a viewer, then inspects the query plans to show *why* the number is what
 * it is.
 *
 * WHY it is gated rather than part of the suite: seeding 100k pages costs minutes
 * and would dominate every CI run, and the default integ database is an in-memory
 * mongodb-memory-server whose numbers say nothing about a real deployment. So it is
 * opt-in and expects a real MongoDB:
 *
 *   MONGO_URI=mongodb://mongo:27017/growi?replicaSet=rs0 \
 *     BACKLINKS_PERF=1 pnpm vitest run page-link-read-perf
 *
 * The harness rewrites the database name to `growi_test_<workerId>`
 * (test/setup/mongo/test-db-config.ts), so the dev `growi` database is never
 * touched.
 *
 * Scale is overridable for a quicker smoke run of the harness itself:
 *   BACKLINKS_PERF_PAGES=10000 BACKLINKS_PERF_INBOUND=2000
 *
 * BACKLINKS_PERF_COLD=1 adds a cold-cache measurement. It temporarily shrinks the
 * server's WiredTiger cache below the working-set size so reads must go to disk,
 * then restores the original size. Opt-in and off by default because it mutates a
 * *server-wide* setting: if the process is killed mid-test the cache stays small
 * until mongod restarts. Never point it at anything but a throwaway MongoDB.
 */

const isEnabled = process.env.BACKLINKS_PERF != null;
const isColdEnabled = process.env.BACKLINKS_PERF_COLD != null;

// Validated in beforeAll, not here: module scope runs during collection even when
// describe.skipIf skips this suite, so a stale `export BACKLINKS_PERF_PAGES=…` in a shell
// would break collection for the whole app-integration project.
const PAGE_COUNT = Number(process.env.BACKLINKS_PERF_PAGES ?? 100_000);
const HUB_INBOUND = Number(process.env.BACKLINKS_PERF_INBOUND ?? 5_000);
/** Outbound links per page besides the hub link — makes the collection realistically sized. */
const EXTRA_LINKS_PER_PAGE = 2;
/** Cache ceiling for the cold run. Must be well under the seeded working set to force eviction. */
const COLD_CACHE_MB = Number(process.env.BACKLINKS_PERF_COLD_CACHE_MB ?? 64);
/** Requirement 3.4: the hub read must come back in interactive time. */
const TARGET_MS = 1_000;
const TIMED_RUNS = 5;
const INSERT_BATCH = 5_000;

const PREFIX = '/backlinks-b21-perf';
const TRASH_PREFIX = `/trash${PREFIX}`;
/** Fixed identities the seed claims; every group name starts with GROUP_NAME_PREFIX. */
const VIEWER_USERNAME = 'b21-viewer';
const FOREIGN_USERNAME = 'b21-foreign';
const FIXTURE_USERNAMES = [VIEWER_USERNAME, FOREIGN_USERNAME];
const GROUP_NAME_PREFIX = 'b21-group-';

type Percentiles = {
  min: number;
  median: number;
  max: number;
};

const summarize = (samples: number[]): Percentiles => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
  };
};

/** One line per measurement so a run can be pasted straight into the spec record. */
const fmt = (p: Percentiles): string =>
  `min ${p.min.toFixed(1)} / median ${p.median.toFixed(1)} / max ${p.max.toFixed(1)} ms`;

const measure = async (
  runs: number,
  fn: () => Promise<unknown>,
): Promise<Percentiles> => {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    // biome-ignore lint/performance/noAwaitInLoops: sequential by design — concurrent runs would measure contention, not latency
    await fn();
    samples.push(performance.now() - started);
  }
  return summarize(samples);
};

/** Collect every stage name in an explain plan tree, so a COLLSCAN anywhere is visible. */
// biome-ignore lint/suspicious/noExplicitAny: explain output is an untyped driver document
const collectStages = (plan: any): string[] => {
  const stages: string[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: same untyped plan nodes
  const walk = (node: any): void => {
    if (node == null || typeof node !== 'object') return;
    if (typeof node.stage === 'string') stages.push(node.stage);
    walk(node.inputStage);
    walk(node.queryPlan);
    if (Array.isArray(node.inputStages)) node.inputStages.forEach(walk);
    if (Array.isArray(node.shards)) {
      for (const shard of node.shards) walk(shard.winningPlan);
    }
  };
  walk(plan);
  return stages;
};

// biome-ignore lint/suspicious/noConsole: reporting the measurement is this test's purpose
const report = (...args: unknown[]): void => console.log(...args);

const adminDb = () => {
  const db = mongoose.connection.db;
  if (db == null) throw new Error('no mongoose connection');
  return db.admin();
};

const wiredTigerCacheBytes = async (): Promise<number> => {
  const status = await adminDb().command({ serverStatus: 1 });
  return status.wiredTiger.cache['maximum bytes configured'];
};

/** Set the server-wide WiredTiger cache ceiling. Caller MUST restore the original. */
const setWiredTigerCacheMb = async (mb: number): Promise<void> => {
  await adminDb().command({
    setParameter: 1,
    wiredTigerEngineRuntimeConfig: `cache_size=${mb}M`,
  });
};

const describeCacheRegime = async (): Promise<{
  workingSetMb: number;
  cacheMb: number;
  avgPageBytes: number;
}> => {
  const db = mongoose.connection.db;
  if (db == null) throw new Error('no mongoose connection');
  const [pages, links] = await Promise.all([
    db.command({ collStats: 'pages' }),
    db.command({ collStats: PAGELINKS_COLLECTION }),
  ]);
  const bytes =
    pages.storageSize +
    pages.totalIndexSize +
    links.storageSize +
    links.totalIndexSize;
  return {
    workingSetMb: Math.round(bytes / 1024 / 1024),
    cacheMb: Math.round((await wiredTigerCacheBytes()) / 1024 / 1024),
    avgPageBytes: Math.round(pages.avgObjSize),
  };
};

describe.skipIf(!isEnabled)('B2.1 backlinks read-path benchmark', () => {
  let Page: PageModel;
  // biome-ignore lint/suspicious/noExplicitAny: the User model is an untyped JS model in GROWI
  let User: any;

  let viewer: IUserHasId;
  let foreignUser: IUserHasId;

  let hubPageId: Types.ObjectId;
  /** Sources that the viewer must actually get back — the assertion this benchmark also proves. */
  let expectedVisibleCount: number;
  /** Every page id this file inserted, so cleanup never guesses. */
  let seededPageIds: Types.ObjectId[] = [];

  const insertInBatches = async <T>(
    // biome-ignore lint/suspicious/noExplicitAny: raw driver insert accepts plain documents
    collection: any,
    docs: T[],
  ): Promise<void> => {
    for (let i = 0; i < docs.length; i += INSERT_BATCH) {
      // biome-ignore lint/performance/noAwaitInLoops: batched sequentially to bound memory and write pressure
      await collection.insertMany(docs.slice(i, i + INSERT_BATCH), {
        ordered: false,
      });
    }
  };

  /**
   * Delete everything this file seeds under a fixed name or path. Runs at the START of
   * beforeAll as well as in afterAll, because seeding takes minutes and a killed run is
   * therefore normal: `username` (models/user/index.js) and UserGroup `name` are both
   * unique, so one leftover fixture makes every later run throw during seeding — and a
   * run that dies inside beforeAll is exactly the one whose cleanup ran on a half-built
   * fixture set. Keyed on the fixed names/paths only — never on a `let` the seed may not
   * have assigned — so the sole precondition is that the model handles are resolved.
   */
  const purgeFixtures = async (): Promise<void> => {
    // beforeAll can throw before the models are looked up (the scale assertions run
    // first), and afterAll still runs. Nothing was seeded in that case.
    if (Page == null || User == null) return;

    const pathRe = new RegExp(`^${escapeStringForMongoRegex(PREFIX)}`);
    const trashPathRe = new RegExp(
      `^${escapeStringForMongoRegex(TRASH_PREFIX)}`,
    );
    // Relations are keyed by user id, so the ids have to be looked up rather than
    // taken from `viewer`/`foreignUser` (unassigned on the pre-seed call).
    const staleUsers = await User.find({
      username: { $in: FIXTURE_USERNAMES },
    })
      .select('_id')
      .lean();

    await Promise.all([
      UserGroupRelation.deleteMany({
        // biome-ignore lint/suspicious/noExplicitAny: lean docs off the untyped User model
        relatedUser: { $in: staleUsers.map((u: any) => u._id) },
      }),
      User.deleteMany({ username: { $in: FIXTURE_USERNAMES } }),
      UserGroup.deleteMany({ name: { $regex: `^${GROUP_NAME_PREFIX}` } }),
      Page.deleteMany({ path: pathRe }),
      Page.deleteMany({ path: trashPathRe }),
      // A killed run's link rows: their fromPage ids died with the process, but every
      // seeded row's toPath carries the fixture prefix.
      prisma.pagelinks.deleteMany({
        where: { toPath: { startsWith: PREFIX } },
      }),
    ]);
  };

  /**
   * A scale that parsed to NaN or 0 makes every seeding loop run zero times — silently,
   * since all comparisons against NaN are false. The read-path measurement would then
   * report a pass on an empty dataset, and its `toHaveLength(expectedVisibleCount)`
   * cross-check cannot catch that: the same broken loop computes both sides as 0.
   * `Number()` rejects nothing, so the values have to be checked explicitly —
   * `Number('10_000')` is NaN (separators are source syntax, not string syntax) and
   * `Number('')` is 0, which `?? fallback` does not intercept.
   */
  const assertPositiveInt = (name: string, value: number): void => {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(
        `${name}="${process.env[name]}" is not a positive integer (parsed as ${value})`,
      );
    }
  };

  beforeAll(
    async () => {
      assertPositiveInt('BACKLINKS_PERF_PAGES', PAGE_COUNT);
      assertPositiveInt('BACKLINKS_PERF_INBOUND', HUB_INBOUND);
      if (isColdEnabled) {
        assertPositiveInt('BACKLINKS_PERF_COLD_CACHE_MB', COLD_CACHE_MB);
      }
      // Actual inbound rows are min(PAGE_COUNT, HUB_INBOUND), so a larger HUB_INBOUND
      // would make the report claim more sources than the seed created.
      if (HUB_INBOUND > PAGE_COUNT) {
        throw new Error(
          `BACKLINKS_PERF_INBOUND (${HUB_INBOUND}) exceeds BACKLINKS_PERF_PAGES (${PAGE_COUNT}): the seed cannot create that many inbound rows`,
        );
      }

      await getInstance();
      Page = mongoose.model<PageDocument, PageModel>('Page');
      User = mongoose.model('User');

      // Self-heal before seeding: see purgeFixtures.
      await purgeFixtures();

      // No index setup here: pagelinks is prisma-only, so its indexes come from
      // migrations/20260901064500-add-indexes-to-pagelinks.js, which the harness has
      // already applied (test/setup/migrate-mongo.ts). That is deliberately not
      // re-created here — the inventory check below has to see what the migration
      // really produced, or it would just be asserting its own setup back at itself.

      await User.insertMany(
        FIXTURE_USERNAMES.map((username) => ({
          name: username,
          username,
          email: `${username}@example.com`,
        })),
      );
      viewer = await User.findOne({ username: VIEWER_USERNAME });
      foreignUser = await User.findOne({ username: FOREIGN_USERNAME });

      // Put the viewer in real user groups. Without them
      // UserGroupRelation.findAllUserGroupIdsRelatedToUser returns [] and
      // generateGrantCondition omits its GRANT_USER_GROUP branch entirely — so the
      // measured grant condition would be structurally simpler than a real member's.
      await UserGroup.insertMany([
        { name: 'b21-group-a' },
        { name: 'b21-group-b' },
        { name: 'b21-group-foreign' },
      ]);
      const [groupA, groupB, groupForeign] = await Promise.all([
        UserGroup.findOne({ name: 'b21-group-a' }),
        UserGroup.findOne({ name: 'b21-group-b' }),
        UserGroup.findOne({ name: 'b21-group-foreign' }),
      ]);
      if (groupA == null || groupB == null || groupForeign == null) {
        throw new Error('failed to seed user groups');
      }
      await UserGroupRelation.insertMany([
        { relatedGroup: groupA._id, relatedUser: viewer._id },
        { relatedGroup: groupB._id, relatedUser: viewer._id },
        { relatedGroup: groupForeign._id, relatedUser: foreignUser._id },
      ]);

      const seedStarted = performance.now();

      // --- pages -----------------------------------------------------------
      // Raw collection inserts: mongoose casting/validation over 100k documents costs
      // more than the seed itself. Because that skips schema defaults, every field a
      // real page carries is written explicitly — not just the ones the read path
      // filters on. Document *size* is what matters here: the viewer filter is a
      // FETCH + projection, so WiredTiger reads whole documents, and a stripped-down
      // 185-byte page would understate that cost against a real ~384-427 byte one.
      hubPageId = new mongoose.Types.ObjectId();
      const now = new Date();
      const rootId = new mongoose.Types.ObjectId();
      // Stand-ins for the reference fields; the read path never follows them, so no
      // Revision/User documents need to exist behind these ids — only their bytes matter.
      const seenUsers = [
        viewer._id,
        foreignUser._id,
        new mongoose.Types.ObjectId(),
      ];

      // biome-ignore lint/suspicious/noExplicitAny: raw documents, not hydrated PageDocuments
      const realisticFields = (): any => ({
        parent: rootId,
        descendantCount: 0,
        revision: new mongoose.Types.ObjectId(),
        latestRevisionBodyLength: 1200,
        creator: viewer._id,
        lastUpdateUser: viewer._id,
        liker: [],
        seenUsers,
        commentCount: 0,
        isEmpty: false,
        createdAt: now,
        updatedAt: now,
        __v: 0,
      });

      // biome-ignore lint/suspicious/noExplicitAny: raw documents, not hydrated PageDocuments
      const pageDocs: any[] = [
        {
          _id: hubPageId,
          path: `${PREFIX}/hub`,
          grant: Page.GRANT_PUBLIC,
          status: Page.STATUS_PUBLISHED,
          grantedUsers: [],
          grantedGroups: [],
          ...realisticFields(),
        },
      ];

      let visible = 0;
      for (let i = 0; i < PAGE_COUNT; i++) {
        const isHubSource = i < HUB_INBOUND;
        // Grant/status mix applied to the hub's sources — the set the viewer filter
        // actually has to sift. Buckets of 20:
        //   0-11 public                       60%  visible
        //   12-13 group-granted to the viewer 10%  visible  (exercises the $elemMatch branch)
        //   14-15 group-granted to others     10%  excluded
        //   16-17 owned by someone else       10%  excluded
        //   18    owned by the viewer          5%  visible
        //   19    trashed                      5%  excluded
        // => 75% visible.
        const bucket = i % 20;
        const trashed = isHubSource && bucket === 19;
        const ownedByViewer = isHubSource && bucket === 18;
        const ownedByForeign = isHubSource && bucket >= 16 && bucket <= 17;
        const groupForeignGranted = isHubSource && bucket >= 14 && bucket <= 15;
        const groupViewerGranted = isHubSource && bucket >= 12 && bucket <= 13;

        if (
          isHubSource &&
          !trashed &&
          !ownedByForeign &&
          !groupForeignGranted
        ) {
          visible++;
        }

        const grant = ((): number => {
          if (ownedByViewer || ownedByForeign) return Page.GRANT_OWNER;
          if (groupViewerGranted || groupForeignGranted) {
            return Page.GRANT_USER_GROUP;
          }
          return Page.GRANT_PUBLIC;
        })();
        const grantedUsers = ownedByViewer
          ? [viewer._id]
          : ownedByForeign
            ? [foreignUser._id]
            : [];
        // Granted to group A (one of the viewer's two) or to the group only the
        // stranger belongs to.
        const grantedGroups = groupViewerGranted
          ? [{ type: 'UserGroup', item: groupA._id }]
          : groupForeignGranted
            ? [{ type: 'UserGroup', item: groupForeign._id }]
            : [];

        pageDocs.push({
          _id: new mongoose.Types.ObjectId(),
          // Trashed pages live under /trash like the real thing, though the filter
          // that excludes them is status-based (addConditionToExcludeTrashed).
          path: trashed
            ? `${TRASH_PREFIX}/source-${i}`
            : `${PREFIX}/source-${i}`,
          grant,
          status: trashed ? Page.STATUS_DELETED : Page.STATUS_PUBLISHED,
          grantedUsers,
          grantedGroups,
          ...realisticFields(),
        });
      }
      expectedVisibleCount = visible;
      seededPageIds = pageDocs.map((d) => d._id);

      await insertInBatches(Page.collection, pageDocs);

      // --- links -----------------------------------------------------------
      // Every source in the first HUB_INBOUND pages points at the hub; every page also
      // carries EXTRA_LINKS_PER_PAGE unrelated rows so the collection (and its indexes)
      // are realistically sized rather than hub-only. toPaths are unique per source,
      // so the unique { fromPage, toPath } index is never violated.
      // biome-ignore lint/suspicious/noExplicitAny: raw documents
      const linkDocs: any[] = [];
      for (let i = 0; i < PAGE_COUNT; i++) {
        const fromPage = seededPageIds[i + 1]; // index 0 is the hub itself
        if (i < HUB_INBOUND) {
          linkDocs.push({
            _id: new mongoose.Types.ObjectId(),
            fromPage,
            toPath: `${PREFIX}/hub`,
            toPage: hubPageId,
          });
        }
        for (let k = 0; k < EXTRA_LINKS_PER_PAGE; k++) {
          const targetIdx = (i * 7 + k * 13 + 1) % PAGE_COUNT;
          linkDocs.push({
            _id: new mongoose.Types.ObjectId(),
            fromPage,
            toPath: `${PREFIX}/source-${targetIdx}`,
            toPage: seededPageIds[targetIdx + 1],
          });
        }
      }

      await insertInBatches(rawPagelinksCollection(), linkDocs);

      report(
        `[B2.1] seeded ${pageDocs.length} pages / ${linkDocs.length} link rows in ${Math.round(performance.now() - seedStarted)} ms`,
      );
      report(
        `[B2.1] hub inbound rows: ${HUB_INBOUND}, expected visible to viewer: ${expectedVisibleCount}`,
      );

      // Working set vs cache: without this the reader cannot tell which regime the
      // numbers describe. A fully cache-resident read is the optimistic case.
      const { workingSetMb, cacheMb, avgPageBytes } =
        await describeCacheRegime();
      report(
        `[B2.1] avg page doc: ${avgPageBytes} B | working set: ${workingSetMb} MiB | WT cache: ${cacheMb} MiB ${
          workingSetMb < cacheMb
            ? '(fully resident — warm reads)'
            : '(exceeds cache)'
        }`,
      );
    },
    30 * 60 * 1000,
  );

  afterAll(
    async () => {
      for (let i = 0; i < seededPageIds.length; i += INSERT_BATCH) {
        const batch = seededPageIds.slice(i, i + INSERT_BATCH);
        // biome-ignore lint/performance/noAwaitInLoops: batched to bound the delete size
        await Promise.all([
          Page.deleteMany({ _id: { $in: batch } }),
          prisma.pagelinks.deleteMany({
            where: { fromPageId: { in: batch.map((id) => id.toString()) } },
          }),
        ]);
      }
      // Guarded: a beforeAll that throws before hubPageId is assigned still runs this
      // hook. Unlike the Mongoose driver, Prisma's `toPageId: hubPageId.toString()`
      // filter only ever matches that literal string — it cannot accidentally widen to
      // "every unresolved row" the way `{toPage: undefined}` did over the raw driver.
      if (hubPageId != null) {
        await prisma.pagelinks.deleteMany({
          where: { toPageId: hubPageId.toString() },
        });
      }
      await purgeFixtures();
    },
    10 * 60 * 1000,
  );

  it('has exactly the three shipped indexes on pagelinks', async () => {
    const indexes = await rawPagelinksCollection().indexes();
    const byKey = new Map(indexes.map((idx) => [JSON.stringify(idx.key), idx]));

    // Closed set, not a presence check: every latency figure this file reports is only
    // meaningful for one index configuration, so an index nobody enumerated must fail
    // here. Notably `{toPage, fromPage}` — the compound B2.1 measured and rejected —
    // would otherwise leave every test in this file green (the distinct merely upgrades
    // to PROJECTION_COVERED <- DISTINCT_SCAN, still index-backed and still under target)
    // while the recorded numbers silently described a configuration that no longer
    // exists. What it reads is the migration's real output, so it doubles as that
    // migration's drift test — and, since nothing reconciles indexes at connect any
    // more, a `growi_test_<workerId>` left over from the mongoose era can fail here
    // with a stale extra index. That is the intended signal, not a flake: drop the
    // test database.
    // `_id_` is included: it is in the inventory, though not one of the three "shipped".
    expect(indexes.map((idx) => idx.name).sort()).toEqual([
      '_id_', // implicit
      'fromPage_1_toPath_1', // replaceOutboundLinks' upsert filter and $nin delete
      'toPage_1', // what findBacklinkSources' distinct rides
      'toPath_1', // repointInboundLinks' toPath-only filter (added by B4)
    ]);

    // Uniqueness is the one property the name set cannot express.
    const compound = byKey.get(JSON.stringify({ fromPage: 1, toPath: 1 }));
    expect(compound?.unique).toBe(true);

    report('[B2.1] pagelinks indexes:', indexes.map((i) => i.name).join(', '));
  });

  it(`returns the hub page's backlinks in under ${TARGET_MS} ms`, async () => {
    // Warm-up: excluded from the samples so the first call's connection/plan-cache
    // priming is not reported as read latency.
    const warm = await findBacklinks(hubPageId, viewer);
    expect(warm).toHaveLength(expectedVisibleCount);

    const full = await measure(TIMED_RUNS, () =>
      findBacklinks(hubPageId, viewer),
    );

    // Sub-steps, to locate the bottleneck rather than just observe the total.
    const distinctOnly = await measure(TIMED_RUNS, () =>
      prisma.pagelinks.findBacklinkSources(hubPageId),
    );
    const sourceIds = await prisma.pagelinks.findBacklinkSources(hubPageId);
    const filterOnly = await measure(TIMED_RUNS, async () => {
      // Production's own query builder, so this sub-step timing cannot drift away from
      // the query findBacklinks issues.
      const { query } = await buildVisibleSourcesQuery(sourceIds, viewer);
      return query.lean().exec();
    });

    report(`[B2.1] findBacklinks (full path):        ${fmt(full)}`);
    report(`[B2.1]   findBacklinkSources (distinct): ${fmt(distinctOnly)}`);
    report(`[B2.1]   viewer-filtered Page query:     ${fmt(filterOnly)}`);
    report(
      `[B2.1] inbound rows scanned: ${sourceIds.length}, returned to viewer: ${expectedVisibleCount}`,
    );

    expect(full.median).toBeLessThan(TARGET_MS);
  });

  it.skipIf(!isColdEnabled)(
    'still returns in interactive time with a cache too small to hold the data',
    async () => {
      // Answers the question the warm numbers cannot: what happens when the pages are
      // NOT already in memory. Shrinking the WT cache below the working set forces
      // eviction, so the FETCH half has to go to storage.
      const originalBytes = await wiredTigerCacheBytes();
      const originalMb = Math.round(originalBytes / 1024 / 1024);
      let restoredBytes: number | undefined;

      try {
        await setWiredTigerCacheMb(COLD_CACHE_MB);
        const regime = await describeCacheRegime();
        report(
          `[B2.1][cold] working set ${regime.workingSetMb} MiB vs cache ${regime.cacheMb} MiB`,
        );
        expect(regime.workingSetMb).toBeGreaterThan(regime.cacheMb);

        // No warm-up discard here — the first read under cache pressure is the
        // interesting one, so it is reported separately from the settled runs.
        const firstStarted = performance.now();
        const first = await findBacklinks(hubPageId, viewer);
        const firstMs = performance.now() - firstStarted;
        expect(first).toHaveLength(expectedVisibleCount);

        const settled = await measure(TIMED_RUNS, () =>
          findBacklinks(hubPageId, viewer),
        );

        report(`[B2.1][cold] first read: ${firstMs.toFixed(1)} ms`);
        report(`[B2.1][cold] settled:    ${fmt(settled)}`);

        expect(settled.median).toBeLessThan(TARGET_MS);
      } finally {
        // Restore the size mongod auto-sized at startup. MiB granularity is lossless:
        // mongod computes its cache in whole MB, so this round-trips byte-exactly
        // (the devcontainer's 7790919680 B is exactly 7430 MiB) — which is why the
        // assertion below can compare bytes. It does replace an auto-sized cache with
        // an explicit one, but only for this mongod process: setParameter is not
        // persisted, so a restart returns to auto-sizing at the same value.
        await setWiredTigerCacheMb(originalMb);
        restoredBytes = await wiredTigerCacheBytes();
        report(
          `[B2.1][cold] restored WT cache to ${restoredBytes} B (was ${originalBytes} B)`,
        );
        if (restoredBytes !== originalBytes) {
          // Reported here as well as asserted below, because a body that already threw
          // skips the assertion — and a mongod left with the wrong cache must not be
          // discoverable only by noticing that everything got slower afterwards.
          report(
            `[B2.1][cold] WARNING: cache NOT restored — mongod is left at ${restoredBytes} B, restart it`,
          );
        }
      }

      // Outside the finally so a failure in the body propagates unmasked; a restore
      // mismatch on the happy path still fails the test rather than only printing.
      expect(restoredBytes).toBe(originalBytes);
    },
    5 * 60 * 1000,
  );

  it('serves both read queries from an index, with no collection scan', async () => {
    const db = mongoose.connection.db;
    if (db == null) throw new Error('no mongoose connection');

    // Explain the command findBacklinkSources really sent, not a transcription of it.
    const readCommands = await capturePagelinkCommands(() =>
      prisma.pagelinks.findBacklinkSources(hubPageId),
    );
    expect(readCommands).toHaveLength(1);

    const distinctExplain = await db.command({
      explain: explainable(readCommands[0].command),
      verbosity: 'queryPlanner',
    });
    const distinctStages = collectStages(
      distinctExplain.queryPlanner?.winningPlan,
    );

    report(
      '[B2.1] read command:',
      JSON.stringify(explainable(readCommands[0].command)),
    );
    report('[B2.1] distinct winning plan stages:', distinctStages.join(' <- '));
    expect(distinctStages).not.toContain('COLLSCAN');
    // A covered distinct collapses to DISTINCT_SCAN; a plain index hit is IXSCAN.
    expect(
      distinctStages.some((s) => s === 'DISTINCT_SCAN' || s === 'IXSCAN'),
    ).toBe(true);

    // The viewer-filtered Page query, built by production — so this no-COLLSCAN
    // guarantee covers the query findBacklinks issues, not a copy of it.
    const sourceIds = await prisma.pagelinks.findBacklinkSources(hubPageId);
    const { query } = await buildVisibleSourcesQuery(sourceIds, viewer);
    // mongoose types explain() as resolving to the query's own result type; the real
    // shape is an untyped driver explain document, matching collectStages' parameter.
    // biome-ignore lint/suspicious/noExplicitAny: driver explain output has no type
    const filterExplain: any = await query.explain('queryPlanner');
    const filterStages = collectStages(
      // explain() on a find returns either the plan directly or an array of them
      (Array.isArray(filterExplain) ? filterExplain[0] : filterExplain)
        .queryPlanner?.winningPlan,
    );

    report(
      '[B2.1] viewer-filter winning plan stages:',
      filterStages.join(' <- '),
    );
    expect(filterStages).not.toContain('COLLSCAN');
    expect(filterStages).toContain('IXSCAN');
  });

  it('rewrites only the edited page rows on a save, never walking all pages', async () => {
    // The no-rescan guarantee (req 3.4): one save touches one source's rows.
    const editedPage = seededPageIds[1];
    const untouchedPage = seededPageIds[2];

    const before = {
      total: await prisma.pagelinks.count(),
      untouched: await prisma.pagelinks.findMany({
        where: { fromPageId: untouchedPage.toString() },
        select: { toPath: true, toPageId: true },
        orderBy: { toPath: 'asc' },
      }),
    };

    // Every write the save issued must be scoped to the edited page.
    const writeCommands = await capturePagelinkCommands(() =>
      syncOutboundLinks(editedPage, [
        { fromPage: editedPage, toPath: `${PREFIX}/hub`, toPage: hubPageId },
      ]),
    );
    expect(writeCommands.length).toBeGreaterThan(0);

    for (const entry of writeCommands) {
      const { command } = entry;
      // The profiler logs each write statement on its own, or a batch envelope when the
      // server groups them — accept either, reject anything else (a new, unreviewed write
      // shape should fail here rather than be skipped).
      const statements =
        command.updates ??
        command.deletes ??
        (command.q != null ? [command] : undefined);
      expect(
        statements,
        `unexpected command: ${JSON.stringify(command)}`,
      ).toBeDefined();
      for (const statement of statements) {
        expect(statement.q?.fromPage?.toString()).toBe(editedPage.toString());
      }
    }

    // No other page's rows moved.
    const afterUntouched = await prisma.pagelinks.findMany({
      where: { fromPageId: untouchedPage.toString() },
      select: { toPath: true, toPageId: true },
      orderBy: { toPath: 'asc' },
    });
    expect(afterUntouched).toStrictEqual(before.untouched);
    // The edited page dropped its EXTRA_LINKS_PER_PAGE rows and kept the hub row.
    expect(await prisma.pagelinks.count()).toBe(
      before.total - EXTRA_LINKS_PER_PAGE,
    );

    // The delete half filters { fromPage, toPath: { $nin } } — confirm that shape is
    // index-served too, so a save cannot degrade into a collection walk. Explained via
    // the raw collection: it plans the literal filter (no ORM casting in between) and
    // its explain() is typed, unlike Query.explain().
    const deleteExplain = await rawPagelinksCollection()
      .find({
        fromPage: editedPage,
        toPath: { $nin: [`${PREFIX}/hub`] },
      })
      .explain('queryPlanner');
    const deleteStages = collectStages(deleteExplain.queryPlanner?.winningPlan);
    report('[B2.1] save-delete filter plan stages:', deleteStages.join(' <- '));
    expect(deleteStages).not.toContain('COLLSCAN');
    expect(deleteStages).toContain('IXSCAN');
  });
});
