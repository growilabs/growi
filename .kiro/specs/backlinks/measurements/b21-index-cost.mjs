/*
 * B2.1 follow-up — what does adding a { toPage, fromPage } compound index to
 * `pagelinks` actually cost, and what does it buy?
 *
 * B2.1 found that findBacklinkSources' `distinct` runs FETCH <- IXSCAN rather than a
 * covered DISTINCT_SCAN, because its key (fromPage) is not in the index it rides
 * ({toPage}). This script measures the three things that decide whether to add the
 * compound: storage, per-save write latency, and read latency.
 *
 * Standalone and throwaway — it uses its own database and drops it at the end. It is
 * kept in the spec because the conclusion recorded in tasks.md rests on these numbers.
 *
 *   node .kiro/specs/backlinks/measurements/b21-index-cost.mjs
 *
 * Two pitfalls this design avoids, both of which produced wrong numbers on the first
 * attempt:
 *
 *  1. Storage must be read with NO writes in between. Reading index sizes before and
 *     after a phase of writes attributes growth in the *existing* indexes to the new
 *     one (that mistake reported "+140%" when the real marginal cost is ~16 B/row).
 *     Sizes also grow as WiredTiger checkpoints, so let the collection settle first.
 *  2. Every measurement is A/B/A' — baseline, changed, baseline again — because this
 *     box is shared and a single before/after pair cannot distinguish an effect from
 *     drift.
 *
 * The read benefit turns out to depend on the link topology, so it is measured for two:
 * one row per source->target (DISTINCT_SCAN has no duplicate keys to skip) and three
 * (it does). A source produces several rows for one target when it links to it more
 * than one way — a path link, a permalink and an anchor link all resolve to the same page.
 */
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../../apps/app/', import.meta.url));
const { MongoClient, ObjectId } = require('mongodb');

const URI = process.env.MONGO_URI ?? 'mongodb://mongo:27017/?replicaSet=rs0';
const DB = 'growi_b21_indexcost';
const COLL = 'pagelinks';

const PAGES = 100_000;
const HUB_INBOUND = 5_000;
const EXTRA_PER_PAGE = 2;
/** A typical page's outbound internal links, i.e. the size of one replaceOutboundLinks. */
const LINKS_PER_SAVE = 10;
const SAVES = 200;
const READ_SAMPLES = 15;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mib = (bytes) => (bytes / 1024 / 1024).toFixed(2);
const log = (...args) => {
  // biome-ignore lint/suspicious/noConsole: this script's output IS its result
  console.log(...args);
};

const planStages = (plan) => {
  const stages = [];
  const walk = (node) => {
    if (node == null || typeof node !== 'object') return;
    if (node.stage) stages.push(node.stage);
    walk(node.inputStage);
    walk(node.queryPlan);
  };
  walk(plan);
  return stages.join(' <- ');
};

const client = new MongoClient(URI);
await client.connect();

/** Seed a fresh collection with the two shipped indexes and B2.1's row volume. */
const seed = async (db, rowsPerSource) => {
  const coll = db.collection(COLL);
  await coll.createIndex({ fromPage: 1, toPath: 1 }, { unique: true });
  await coll.createIndex({ toPage: 1 });

  const pageIds = Array.from({ length: PAGES }, () => new ObjectId());
  const hubId = new ObjectId();
  const rows = [];
  for (let i = 0; i < PAGES; i++) {
    if (i < HUB_INBOUND) {
      for (let r = 0; r < rowsPerSource; r++) {
        rows.push({
          fromPage: pageIds[i],
          toPath: `/hub-alias-${r}`,
          toPage: hubId,
        });
      }
    }
    for (let k = 0; k < EXTRA_PER_PAGE; k++) {
      const target = (i * 7 + k * 13 + 1) % PAGES;
      rows.push({
        fromPage: pageIds[i],
        toPath: `/source-${target}`,
        toPage: pageIds[target],
      });
    }
  }
  for (let i = 0; i < rows.length; i += 5_000) {
    await coll.insertMany(rows.slice(i, i + 5_000), { ordered: false });
  }
  return { coll, pageIds, hubId, rowCount: rows.length };
};

const indexSizes = async (db) => {
  const stats = await db.command({ collStats: COLL });
  return stats.indexSizes;
};

const measureDistinct = async (db, coll, hubId, expected) => {
  const explained = await db.command({
    explain: { distinct: COLL, key: 'fromPage', query: { toPage: hubId } },
    verbosity: 'queryPlanner',
  });
  await coll.distinct('fromPage', { toPage: hubId }); // warm
  const samples = [];
  for (let i = 0; i < READ_SAMPLES; i++) {
    const started = performance.now();
    const result = await coll.distinct('fromPage', { toPage: hubId });
    samples.push(performance.now() - started);
    if (result.length !== expected) {
      throw new Error(`expected ${expected} sources, got ${result.length}`);
    }
  }
  return {
    plan: planStages(explained.queryPlanner.winningPlan),
    ms: median(samples),
  };
};

/** The exact bulkWrite shape PageLink.replaceOutboundLinks issues for one save. */
const save = async (coll, fromPage, hubId) => {
  const toPaths = Array.from(
    { length: LINKS_PER_SAVE },
    (_, n) => `/target-${n}`,
  );
  const ops = [
    ...toPaths.map((toPath) => ({
      updateOne: {
        filter: { fromPage, toPath },
        update: { $set: { toPage: hubId } },
        upsert: true,
      },
    })),
    { deleteMany: { filter: { fromPage, toPath: { $nin: toPaths } } } },
  ];
  const started = performance.now();
  await coll.bulkWrite(ops, { ordered: true });
  return performance.now() - started;
};

/**
 * Each phase saves a disjoint block of pages, so every phase does identical work on
 * identically-shaped pages (EXTRA_PER_PAGE seeded rows -> LINKS_PER_SAVE rows).
 */
const measureSaves = async (coll, pageIds, hubId, offset) => {
  const samples = [];
  for (let i = 0; i < SAVES; i++) {
    samples.push(await save(coll, pageIds[offset + i], hubId));
  }
  return median(samples);
};

// --- read latency + storage, for both link topologies ----------------------
for (const rowsPerSource of [1, 3]) {
  const db = client.db(DB);
  await db.dropDatabase();
  const { coll, hubId, rowCount } = await seed(db, rowsPerSource);

  log(
    `\n### ${rowsPerSource} row(s) per source -> hub  (${rowCount} rows, ${HUB_INBOUND * rowsPerSource} inbound)`,
  );

  const before = await indexSizes(db);
  const base1 = await measureDistinct(db, coll, hubId, HUB_INBOUND);
  log(`  2 indexes : ${base1.plan.padEnd(42)} ${base1.ms.toFixed(2)} ms`);

  await coll.createIndex({ toPage: 1, fromPage: 1 });
  const after = await indexSizes(db);
  const withIdx = await measureDistinct(db, coll, hubId, HUB_INBOUND);
  log(`  3 indexes : ${withIdx.plan.padEnd(42)} ${withIdx.ms.toFixed(2)} ms`);

  await coll.dropIndex('toPage_1_fromPage_1');
  const base2 = await measureDistinct(db, coll, hubId, HUB_INBOUND);
  log(
    `  2 again   : ${base2.plan.padEnd(42)} ${base2.ms.toFixed(2)} ms   (drift check)`,
  );

  const added = after.toPage_1_fromPage_1;
  log(
    `  new index: ${mib(added)} MiB  (${(added / rowCount).toFixed(1)} B/row)  |  existing: ${Object.keys(
      before,
    )
      .map((k) => `${k} ${mib(before[k])}->${mib(after[k])}`)
      .join(', ')}`,
  );
}

// --- per-save write latency ------------------------------------------------
{
  const db = client.db(DB);
  await db.dropDatabase();
  const { coll, pageIds, hubId } = await seed(db, 1);

  log(
    `\n### per-save write cost (${SAVES} saves of ${LINKS_PER_SAVE} links each)`,
  );

  const base1 = await measureSaves(coll, pageIds, hubId, 10_000);
  log(`  2 indexes : median ${base1.toFixed(2)} ms`);

  const buildStarted = performance.now();
  await coll.createIndex({ toPage: 1, fromPage: 1 });
  log(`  index build: ${Math.round(performance.now() - buildStarted)} ms`);

  const withIdx = await measureSaves(coll, pageIds, hubId, 20_000);
  log(`  3 indexes : median ${withIdx.toFixed(2)} ms`);

  await coll.dropIndex('toPage_1_fromPage_1');
  const base2 = await measureSaves(coll, pageIds, hubId, 30_000);
  log(`  2 again   : median ${base2.toFixed(2)} ms   (drift check)`);
}

await client.db(DB).dropDatabase();
await client.close();
