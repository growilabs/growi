import type { IUserHasId } from '@growi/core';
import { escapeStringForMongoRegex } from '@growi/core/dist/utils';
import mongoose, { type Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type { PageDocument, PageModel } from '~/server/models/page';
import { PageQueryBuilder } from '~/server/models/page';

import PageLink from '../models/page-link';
import { findBacklinks } from './find-backlinks';
import { syncOutboundLinks } from './page-link-sync';

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
 * (test/setup/mongo/utils.ts), so the dev `growi` database is never touched.
 *
 * Scale is overridable for a quicker smoke run of the harness itself:
 *   BACKLINKS_PERF_PAGES=10000 BACKLINKS_PERF_INBOUND=2000
 */

const isEnabled = process.env.BACKLINKS_PERF != null;

const PAGE_COUNT = Number(process.env.BACKLINKS_PERF_PAGES ?? 100_000);
const HUB_INBOUND = Number(process.env.BACKLINKS_PERF_INBOUND ?? 5_000);
/** Outbound links per page besides the hub link — makes the collection realistically sized. */
const EXTRA_LINKS_PER_PAGE = 2;
/** Requirement 3.4: the hub read must come back in interactive time. */
const TARGET_MS = 1_000;
const TIMED_RUNS = 5;
const INSERT_BATCH = 5_000;

const PREFIX = '/backlinks-b21-perf';
const TRASH_PREFIX = `/trash${PREFIX}`;

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

  beforeAll(
    async () => {
      await getInstance();
      Page = mongoose.model<PageDocument, PageModel>('Page');
      User = mongoose.model('User');

      // Wait for the model's own autoIndex build (B1.2) rather than creating indexes
      // here — B2.1 is a check that the shipped indexes suffice, not a place to add any.
      await PageLink.init();

      await User.insertMany([
        {
          name: 'b21-viewer',
          username: 'b21-viewer',
          email: 'b21-viewer@example.com',
        },
        {
          name: 'b21-foreign',
          username: 'b21-foreign',
          email: 'b21-foreign@example.com',
        },
      ]);
      viewer = await User.findOne({ username: 'b21-viewer' });
      foreignUser = await User.findOne({ username: 'b21-foreign' });

      const seedStarted = performance.now();

      // --- pages -----------------------------------------------------------
      // Raw collection inserts: mongoose casting/validation over 100k documents costs
      // more than the seed itself, and the read path only reads path/grant/status/
      // grantedUsers/grantedGroups/isEmpty. Defaults are therefore set explicitly.
      hubPageId = new mongoose.Types.ObjectId();
      const now = new Date();

      // biome-ignore lint/suspicious/noExplicitAny: raw documents, not hydrated PageDocuments
      const pageDocs: any[] = [
        {
          _id: hubPageId,
          path: `${PREFIX}/hub`,
          grant: Page.GRANT_PUBLIC,
          status: Page.STATUS_PUBLISHED,
          isEmpty: false,
          grantedUsers: [],
          grantedGroups: [],
          createdAt: now,
          updatedAt: now,
        },
      ];

      let visible = 0;
      for (let i = 0; i < PAGE_COUNT; i++) {
        const isHubSource = i < HUB_INBOUND;
        // Grant/status mix applied to the hub's sources — the set the viewer filter
        // actually has to sift. Buckets of 20: 0-14 public (75%), 15-17 owned by
        // someone else (15%, excluded), 18 owned by the viewer (5%, visible),
        // 19 trashed (5%, excluded) — so 80% is visible.
        const bucket = i % 20;
        const trashed = isHubSource && bucket === 19;
        const ownedByViewer = isHubSource && bucket === 18;
        const ownedByForeign = isHubSource && bucket >= 15 && bucket <= 17;

        if (isHubSource && !trashed && !ownedByForeign) visible++;

        const grant =
          ownedByViewer || ownedByForeign
            ? Page.GRANT_OWNER
            : Page.GRANT_PUBLIC;
        const grantedUsers = ownedByViewer
          ? [viewer._id]
          : ownedByForeign
            ? [foreignUser._id]
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
          isEmpty: false,
          grantedUsers,
          grantedGroups: [],
          createdAt: now,
          updatedAt: now,
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

      await insertInBatches(PageLink.collection, linkDocs);

      report(
        `[B2.1] seeded ${pageDocs.length} pages / ${linkDocs.length} link rows in ${Math.round(performance.now() - seedStarted)} ms`,
      );
      report(
        `[B2.1] hub inbound rows: ${HUB_INBOUND}, expected visible to viewer: ${expectedVisibleCount}`,
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
          PageLink.deleteMany({ fromPage: { $in: batch } }),
        ]);
      }
      await Promise.all([
        PageLink.deleteMany({ toPage: hubPageId }),
        User.deleteMany({ username: { $in: ['b21-viewer', 'b21-foreign'] } }),
        // Safety net for any path-prefixed leftovers (escaped per rules/mongodb-regex.md).
        Page.deleteMany({
          path: new RegExp(`^${escapeStringForMongoRegex(PREFIX)}`),
        }),
        Page.deleteMany({
          path: new RegExp(`^${escapeStringForMongoRegex(TRASH_PREFIX)}`),
        }),
      ]);
    },
    10 * 60 * 1000,
  );

  it('has exactly the two shipped indexes on pagelinks', async () => {
    const indexes = await PageLink.collection.indexes();
    const byKey = new Map(indexes.map((idx) => [JSON.stringify(idx.key), idx]));

    // { toPage } — what findBacklinkSources' distinct rides
    expect(byKey.has(JSON.stringify({ toPage: 1 }))).toBe(true);
    // unique { fromPage, toPath } — replaceOutboundLinks' upsert filter and $nin delete
    const compound = byKey.get(JSON.stringify({ fromPage: 1, toPath: 1 }));
    expect(compound).toBeDefined();
    expect(compound?.unique).toBe(true);

    // Dropped in B2.2 as unused; their absence is expected, not a missing index.
    expect(byKey.has(JSON.stringify({ fromPage: 1 }))).toBe(false);
    expect(byKey.has(JSON.stringify({ toPath: 1 }))).toBe(false);

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
      PageLink.findBacklinkSources(hubPageId),
    );
    const sourceIds = await PageLink.findBacklinkSources(hubPageId);
    const filterOnly = await measure(TIMED_RUNS, async () => {
      const builder = new PageQueryBuilder(
        Page.find({ _id: { $in: sourceIds } }),
      );
      await builder.addViewerCondition(viewer);
      builder.addConditionToExcludeTrashed();
      return builder.query.select('_id path').lean().exec();
    });

    report(`[B2.1] findBacklinks (full path):        ${fmt(full)}`);
    report(`[B2.1]   findBacklinkSources (distinct): ${fmt(distinctOnly)}`);
    report(`[B2.1]   viewer-filtered Page query:     ${fmt(filterOnly)}`);
    report(
      `[B2.1] inbound rows scanned: ${sourceIds.length}, returned to viewer: ${expectedVisibleCount}`,
    );

    expect(full.median).toBeLessThan(TARGET_MS);
  });

  it('serves both read queries from an index, with no collection scan', async () => {
    const db = mongoose.connection.db;
    if (db == null) throw new Error('no mongoose connection');

    // distinct on { toPage } — explained via the command, since Model.distinct()
    // has no .explain().
    const distinctExplain = await db.command({
      explain: {
        distinct: PageLink.collection.collectionName,
        key: 'fromPage',
        query: { toPage: hubPageId },
      },
      verbosity: 'queryPlanner',
    });
    const distinctStages = collectStages(
      distinctExplain.queryPlanner?.winningPlan,
    );

    report('[B2.1] distinct winning plan stages:', distinctStages.join(' <- '));
    expect(distinctStages).not.toContain('COLLSCAN');
    // A covered distinct collapses to DISTINCT_SCAN; a plain index hit is IXSCAN.
    expect(
      distinctStages.some((s) => s === 'DISTINCT_SCAN' || s === 'IXSCAN'),
    ).toBe(true);

    // The viewer-filtered Page query. Mirrors find-backlinks.ts — keep the two in
    // step if that query changes.
    const sourceIds = await PageLink.findBacklinkSources(hubPageId);
    const builder = new PageQueryBuilder(
      Page.find({ _id: { $in: sourceIds } }),
    );
    await builder.addViewerCondition(viewer);
    builder.addConditionToExcludeTrashed();
    const filterExplain = await builder.query
      .select('_id path')
      .explain('queryPlanner');
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
      total: await PageLink.countDocuments(),
      untouched: await PageLink.find({ fromPage: untouchedPage })
        .select('toPath toPage -_id')
        .sort({ toPath: 1 })
        .lean(),
    };

    const bulkWriteSpy = vi.spyOn(PageLink, 'bulkWrite');

    await syncOutboundLinks(editedPage, [
      { fromPage: editedPage, toPath: `${PREFIX}/hub`, toPage: hubPageId },
    ]);

    // Every operation the save issued must be scoped to the edited page.
    expect(bulkWriteSpy).toHaveBeenCalledTimes(1);
    const ops = bulkWriteSpy.mock.calls[0][0];
    for (const op of ops) {
      // replaceOutboundLinks issues only these two op kinds; anything else would be a
      // new, unreviewed write shape and should fail this check rather than be skipped.
      const filter =
        'updateOne' in op
          ? op.updateOne.filter
          : 'deleteMany' in op
            ? op.deleteMany.filter
            : undefined;
      expect(filter?.fromPage).toStrictEqual(editedPage);
    }
    bulkWriteSpy.mockRestore();

    // And no other page's rows moved.
    const afterUntouched = await PageLink.find({ fromPage: untouchedPage })
      .select('toPath toPage -_id')
      .sort({ toPath: 1 })
      .lean();
    expect(afterUntouched).toStrictEqual(before.untouched);
    // The edited page dropped its EXTRA_LINKS_PER_PAGE rows and kept the hub row.
    expect(await PageLink.countDocuments()).toBe(
      before.total - EXTRA_LINKS_PER_PAGE,
    );

    // The delete half filters { fromPage, toPath: { $nin } } — confirm that shape is
    // index-served too, so a save cannot degrade into a collection walk. Explained via
    // the raw collection: it plans the literal filter (no mongoose casting in between)
    // and its explain() is typed, unlike Query.explain().
    const deleteExplain = await PageLink.collection
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
