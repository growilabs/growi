import { execSync } from 'node:child_process';
import type { IndexDescription } from 'mongodb';
import { MongoClient } from 'mongodb';

// #11752: migrate-mongo ran once per test file (~150 times in CI), saturating
// the runner. This is the database migrations are run into exactly once
// (by global-setup.ts); every test file then clones it instead of migrating.
export const TEMPLATE_DB_NAME = 'growi_test_template';

export function runMigrations(mongoUri: string): void {
  execSync('pnpm run dev:migrate:up', {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MONGO_URI: mongoUri,
    },
    stdio: 'inherit',
  });
}

type IndexKeySpec = { name?: string; key: Record<string, unknown> };

/**
 * Throws if the target collection's non-default indexes don't match the
 * source's, by name and key. migrate-mongo stays the only place index
 * definitions are written; this only catches the clone step silently
 * failing to reproduce them.
 */
export function assertIndexParity(
  sourceIndexes: readonly IndexKeySpec[],
  targetIndexes: readonly IndexKeySpec[],
  collectionName: string,
): void {
  const normalize = (indexes: readonly IndexKeySpec[]) =>
    indexes
      .filter((idx) => idx.name !== '_id_')
      .map((idx) => ({ name: idx.name, key: idx.key }))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  const sourceNormalized = normalize(sourceIndexes);
  const targetNormalized = normalize(targetIndexes);

  if (JSON.stringify(sourceNormalized) !== JSON.stringify(targetNormalized)) {
    throw new Error(
      `Index mismatch after cloning template DB collection "${collectionName}": ` +
        `expected ${JSON.stringify(sourceNormalized)}, got ${JSON.stringify(targetNormalized)}`,
    );
  }
}

/**
 * Clones every collection (options, non-default indexes, documents) from
 * sourceDbName into targetDbName on the same MongoDB server.
 *
 * Deliberately does not reuse this file's later mongoose connection (see
 * migrate-mongo.ts): Mongoose's autoIndex runs as soon as a model registers
 * against a live connection, so connecting mongoose before this function
 * finishes would race Mongoose's own index creation against this function's
 * dropDatabase/createIndexes -- confirmed by reproducing exactly that as
 * spurious assertIndexParity failures when setupFiles was reordered to
 * connect mongoose first. Runs before mongoose connects instead (own
 * short-lived MongoClient), so there is no other writer touching targetDb.
 */
export async function cloneDatabase(
  serverUri: string,
  sourceDbName: string,
  targetDbName: string,
): Promise<void> {
  const client = new MongoClient(serverUri);
  try {
    await client.connect();
    const sourceDb = client.db(sourceDbName);
    const targetDb = client.db(targetDbName);

    // Makes cloning idempotent: a repeated local run against a persistent
    // external MongoDB (unlike CI's fresh-per-job service container) would
    // otherwise re-target a database already holding a previous clone, and
    // createCollection/insertMany below would fail on the leftover data.
    await targetDb.dropDatabase();

    const collectionInfos = await sourceDb.listCollections().toArray();

    for (const info of collectionInfos) {
      await targetDb.createCollection(info.name, info.options ?? {});

      const sourceColl = sourceDb.collection(info.name);
      const targetColl = targetDb.collection(info.name);

      const sourceIndexes = await sourceColl.indexes();
      const nonDefaultIndexes = sourceIndexes.filter(
        (idx) => idx.name !== '_id_',
      );
      if (nonDefaultIndexes.length > 0) {
        await targetColl.createIndexes(nonDefaultIndexes as IndexDescription[]);
      }

      const docs = await sourceColl.find({}).toArray();
      if (docs.length > 0) {
        await targetColl.insertMany(docs);
      }

      assertIndexParity(sourceIndexes, await targetColl.indexes(), info.name);
    }
  } finally {
    await client.close();
  }
}
