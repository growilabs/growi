/**
 * Integration test for the revision path -> pageId migration.
 *
 * Runs against the real (in-memory) MongoDB test database wired by the
 * `app-integration-exclusive` Vitest project (see vitest.workspace.mts) —
 * mongoose and prisma are NOT mocked (and this file never imports `mongoose` or
 * `prisma` itself); `up()`/`down()` execute for real against that database.
 * `pages`/`revisions` documents are seeded and read back through a plain
 * `mongodb` driver `MongoClient` connected to the same per-worker test database,
 * bypassing model-level schema validation so the pre-migration legacy document
 * shapes (`revisions.path`, no `pages` required fields) can be represented
 * directly — exactly how the migration itself finds them in production. The
 * `Page` mongoose model gets registered as a side effect of the migration's own
 * `getModelSafely('Page') || getPageModel()` fallback.
 *
 * Staying off both mongoose and prisma here is deliberate: it is what lets the
 * same test hold while `revisions` is ported from the Mongoose model to Prisma
 * (#11602). Seed and assert through the driver only.
 *
 * WHY the `exclusive` project: both `up()` and `down()` operate on the whole
 * database (every page with a revision), and `down()` in particular rewrites
 * every revision that is pageId-keyed — i.e. every revision in its current,
 * post-migration shape — back to the legacy path-keyed shape. Sharing a database
 * with the ordinary integration tests would let this file silently corrupt
 * fixtures any other file in the same worker left behind.
 */
import type { Collection, Db } from 'mongodb';
import { MongoClient, ObjectId } from 'mongodb';

import { getTestDbConfig } from '^/test/setup/mongo/test-db-config';

describe('20211227060705-revision-path-to-page-id-schema-migration--fixed-8998', () => {
  let migrate: typeof import('./20211227060705-revision-path-to-page-id-schema-migration--fixed-8998');
  let client: MongoClient;
  let db: Db;
  let pages: Collection;
  let revisions: Collection;

  const pageIds: ObjectId[] = [];
  const revisionIds: ObjectId[] = [];

  beforeAll(async () => {
    const { mongoUri } = getTestDbConfig();
    if (mongoUri == null) {
      throw new Error('mongoUri is not resolved by the test mongo setup');
    }

    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db();
    pages = db.collection('pages');
    revisions = db.collection('revisions');

    migrate = await import(
      './20211227060705-revision-path-to-page-id-schema-migration--fixed-8998'
    );
  });

  afterAll(async () => {
    await client.close();
  });

  afterEach(async () => {
    if (pageIds.length > 0) {
      await pages.deleteMany({ _id: { $in: pageIds } });
      pageIds.length = 0;
    }
    if (revisionIds.length > 0) {
      await revisions.deleteMany({ _id: { $in: revisionIds } });
      revisionIds.length = 0;
    }
  });

  // Seeds one legacy page with N legacy (path-keyed) revisions, tracking the
  // created ids for cleanup.
  async function seedLegacyPage(
    path: string,
    revisionCount: number,
  ): Promise<{ pageId: ObjectId; pageRevisionIds: ObjectId[] }> {
    const pageId = new ObjectId();
    const pageRevisionIds = Array.from(
      { length: revisionCount },
      () => new ObjectId(),
    );

    await pages.insertOne({
      _id: pageId,
      path,
      revision: pageRevisionIds.at(-1),
    });
    await revisions.insertMany(
      pageRevisionIds.map((id) => ({
        _id: id,
        path,
        body: `body of ${path}`,
      })),
    );

    pageIds.push(pageId);
    revisionIds.push(...pageRevisionIds);

    return { pageId, pageRevisionIds };
  }

  describe('up', () => {
    it('moves each page\'s revisions from path-keyed to pageId-keyed, leaving unrelated revisions untouched', async () => {
      const pathA = `/migration-test/${new ObjectId().toHexString()}`;
      const pathB = `/migration-test/${new ObjectId().toHexString()}`;
      const { pageId: pageIdA, pageRevisionIds: revisionIdsA } =
        await seedLegacyPage(pathA, 2);
      const { pageId: pageIdB, pageRevisionIds: revisionIdsB } =
        await seedLegacyPage(pathB, 1);

      // A decoy revision with no corresponding page: must never be touched.
      const decoyId = new ObjectId();
      const decoyPath = `/migration-test/decoy-${decoyId.toHexString()}`;
      await revisions.insertOne({
        _id: decoyId,
        path: decoyPath,
        body: 'untouched',
      });
      revisionIds.push(decoyId);

      await migrate.up();

      const migratedA = await revisions
        .find({ _id: { $in: revisionIdsA } })
        .toArray();
      expect(migratedA).toHaveLength(2);
      for (const doc of migratedA) {
        expect(doc.pageId?.toString()).toBe(pageIdA.toString());
        expect(doc.path).toBeUndefined();
      }

      const migratedB = await revisions
        .find({ _id: { $in: revisionIdsB } })
        .toArray();
      expect(migratedB).toHaveLength(1);
      expect(migratedB[0].pageId?.toString()).toBe(pageIdB.toString());
      expect(migratedB[0].path).toBeUndefined();

      // No path-keyed revision documents remain for either migrated page.
      expect(
        await revisions.countDocuments({ path: { $in: [pathA, pathB] } }),
      ).toBe(0);

      // The decoy (no matching page) is left completely as-is.
      const decoy = await revisions.findOne({ _id: decoyId });
      expect(decoy?.path).toBe(decoyPath);
      expect(decoy?.pageId).toBeUndefined();
    });

    it('processes every page even when the number of pages spans multiple internal batches', async () => {
      const prefix = `/migration-test/batch-${new ObjectId().toHexString()}`;
      const seeded = await Promise.all(
        Array.from({ length: 301 }, (_, i) =>
          seedLegacyPage(`${prefix}/${i}`, 1),
        ),
      );
      const allRevisionIds = seeded.flatMap((s) => s.pageRevisionIds);

      await migrate.up();

      const migratedCount = await revisions.countDocuments({
        _id: { $in: allRevisionIds },
        pageId: { $exists: true },
        path: { $exists: false },
      });
      expect(migratedCount).toBe(301);
    });

    it('is idempotent: running it again leaves already-migrated revisions unchanged', async () => {
      const path = `/migration-test/${new ObjectId().toHexString()}`;
      const { pageId, pageRevisionIds } = await seedLegacyPage(path, 1);

      await migrate.up();
      const firstRun = await revisions.findOne({ _id: pageRevisionIds[0] });

      await migrate.up();
      const secondRun = await revisions.findOne({ _id: pageRevisionIds[0] });

      expect(secondRun?.pageId?.toString()).toBe(pageId.toString());
      expect(secondRun).toEqual(firstRun);
    });
  });

  describe('down', () => {
    it('reverts each page\'s revisions from pageId-keyed back to path-keyed', async () => {
      const path = `/migration-test/${new ObjectId().toHexString()}`;
      const { pageRevisionIds } = await seedLegacyPage(path, 2);

      await migrate.up();
      await migrate.down();

      const reverted = await revisions
        .find({ _id: { $in: pageRevisionIds } })
        .toArray();
      expect(reverted).toHaveLength(2);
      for (const doc of reverted) {
        expect(doc.path).toBe(path);
        expect(doc.pageId).toBeUndefined();
      }
    });
  });
});
