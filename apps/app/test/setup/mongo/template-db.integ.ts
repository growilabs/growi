import { MongoClient } from 'mongodb';

import { cloneDatabase } from './template-db';

// Exercises the actual clone mechanism the per-file setup relies on (#11752);
// only meaningful against an external MongoDB, so it's a no-op locally where
// MongoMemoryServer is used instead (see migrate-mongo.ts's same guard).
//
// Manages its own MongoClient instead of the shared per-file mongoose
// connection (mongo/index.ts) because this test needs source/target database
// names of its own choosing, unrelated to this file's own growi_test_<n> --
// it is exercising the cloning mechanism itself, not application code that
// happens to need a database.
const mongoUri = process.env.MONGO_URI;

describe.skipIf(mongoUri == null)('cloneDatabase', () => {
  const sourceDbName = `growi_test_template_db_clone_source_${process.pid}`;
  const targetDbName = `growi_test_template_db_clone_target_${process.pid}`;
  let client: MongoClient;

  beforeAll(async () => {
    // biome-ignore lint/style/noNonNullAssertion: guarded by describe.skipIf above
    client = new MongoClient(mongoUri!);
    await client.connect();

    const sourceDb = client.db(sourceDbName);
    await sourceDb.collection('widgets').insertMany([
      { _id: 'a', name: 'alpha' },
      { _id: 'b', name: 'beta' },
    ]);
    await sourceDb
      .collection('widgets')
      .createIndex({ name: 1 }, { unique: true, name: 'name_1' });

    // biome-ignore lint/style/noNonNullAssertion: guarded by describe.skipIf above
    await cloneDatabase(mongoUri!, sourceDbName, targetDbName);
  });

  afterAll(async () => {
    await client.db(sourceDbName).dropDatabase();
    await client.db(targetDbName).dropDatabase();
    await client.close();
  });

  it('copies every document into the target database', async () => {
    const docs = await client
      .db(targetDbName)
      .collection('widgets')
      .find({}, { sort: { _id: 1 } })
      .toArray();
    expect(docs).toEqual([
      { _id: 'a', name: 'alpha' },
      { _id: 'b', name: 'beta' },
    ]);
  });

  it("recreates the source collection's non-default indexes", async () => {
    const indexes = await client
      .db(targetDbName)
      .collection('widgets')
      .indexes();
    const nameIndex = indexes.find((idx) => idx.name === 'name_1');
    expect(nameIndex).toMatchObject({ key: { name: 1 }, unique: true });
  });

  it('can be called again against a target that already holds a previous clone, without duplicating documents', async () => {
    // Every test file's beforeAll clones into that file's own database, but a
    // repeated local run against a persistent external MongoDB (not a fresh
    // per-job CI container) re-targets a database that already holds the
    // previous run's clone -- this must not fail or accumulate duplicates.
    // biome-ignore lint/style/noNonNullAssertion: guarded by describe.skipIf above
    await cloneDatabase(mongoUri!, sourceDbName, targetDbName);

    const docs = await client
      .db(targetDbName)
      .collection('widgets')
      .find({}, { sort: { _id: 1 } })
      .toArray();
    expect(docs).toEqual([
      { _id: 'a', name: 'alpha' },
      { _id: 'b', name: 'beta' },
    ]);
  });
});
