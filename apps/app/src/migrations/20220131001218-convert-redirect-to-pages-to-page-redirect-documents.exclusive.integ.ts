import type { Collection, Db } from 'mongodb';
import { MongoClient, ObjectId } from 'mongodb';

import { getTestDbConfig } from '^/test/setup/mongo/test-db-config';

describe('20220131001218-convert-redirect-to-pages-to-page-redirect-documents', () => {
  let migrate: typeof import('./20220131001218-convert-redirect-to-pages-to-page-redirect-documents');
  let client: MongoClient;
  let db: Db;
  let pages: Collection;
  let pageRedirects: Collection;

  beforeAll(async () => {
    const { mongoUri } = getTestDbConfig();
    if (mongoUri == null) {
      throw new Error('mongoUri is not resolved by the test mongo setup');
    }

    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db();
    pages = db.collection('pages');
    pageRedirects = db.collection('pageredirects');

    migrate = await import(
      './20220131001218-convert-redirect-to-pages-to-page-redirect-documents'
    );
  });

  afterAll(async () => {
    await client.close();
  });

  afterEach(async () => {
    await pages.deleteMany({});
    await pageRedirects.deleteMany({});
  });

  describe('up', () => {
    it('moves a redirecting page into a PageRedirect document and removes the page, leaving a non-redirecting page untouched', async () => {
      const fromPath = `/migration-test/${new ObjectId().toHexString()}`;
      const toPath = `/migration-test/target-${new ObjectId().toHexString()}`;
      await pages.insertOne({ path: fromPath, redirectTo: toPath });

      const keptPath = `/migration-test/kept-${new ObjectId().toHexString()}`;
      await pages.insertOne({ path: keptPath, redirectTo: null });

      await migrate.up(db);

      const redirect = await pageRedirects.findOne({ fromPath });
      expect(redirect?.toPath).toBe(toPath);
      await expect(pages.findOne({ path: fromPath })).resolves.toBeNull();

      const kept = await pages.findOne({ path: keptPath });
      expect(kept?.redirectTo).toBeNull();
    });

    it('processes every redirecting page even when the number of pages spans multiple internal batches', async () => {
      const prefix = `/migration-test/batch-${new ObjectId().toHexString()}`;
      const count = 250; // BATCH_SIZE is 100, so this spans 3 internal batches

      await pages.insertMany(
        Array.from({ length: count }, (_, i) => ({
          path: `${prefix}/${i}`,
          redirectTo: `${prefix}/${i}-target`,
        })),
      );

      await migrate.up(db);

      expect(
        await pageRedirects.countDocuments({
          fromPath: { $regex: `^${prefix}` },
        }),
      ).toBe(count);
      expect(
        await pages.countDocuments({ path: { $regex: `^${prefix}` } }),
      ).toBe(0);
    });

    it('is idempotent: running it again once the redirecting pages are already migrated is a no-op', async () => {
      const fromPath = `/migration-test/${new ObjectId().toHexString()}`;
      const toPath = `/migration-test/target-${new ObjectId().toHexString()}`;
      await pages.insertOne({ path: fromPath, redirectTo: toPath });

      await migrate.up(db);
      await migrate.up(db);

      await expect(pageRedirects.countDocuments({ fromPath })).resolves.toBe(1);
    });
  });

  describe('down', () => {
    it('reverts a PageRedirect document back into a redirecting page and clears the collection', async () => {
      const fromPath = `/migration-test/${new ObjectId().toHexString()}`;
      const toPath = `/migration-test/target-${new ObjectId().toHexString()}`;
      await pageRedirects.insertOne({ fromPath, toPath });

      await migrate.down(db);

      const page = await pages.findOne({ path: fromPath });
      expect(page?.redirectTo).toBe(toPath);
      await expect(pageRedirects.countDocuments({})).resolves.toBe(0);
    });

    it('round-trips: up() followed by down() restores the original redirecting page', async () => {
      const fromPath = `/migration-test/${new ObjectId().toHexString()}`;
      const toPath = `/migration-test/target-${new ObjectId().toHexString()}`;
      await pages.insertOne({ path: fromPath, redirectTo: toPath });

      await migrate.up(db);
      await migrate.down(db);

      const page = await pages.findOne({ path: fromPath });
      expect(page?.redirectTo).toBe(toPath);
      await expect(pageRedirects.countDocuments({})).resolves.toBe(0);
    });
  });
});
