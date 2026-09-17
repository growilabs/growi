/**
 * Integration test for the attachmentType backfill migration.
 *
 * Runs against the real (in-memory) MongoDB test database wired by the
 * `app-integration-exclusive` Vitest project (see vitest.workspace.mts) —
 * mongoose and prisma are NOT mocked (and this file never imports `mongoose`
 * or `prisma` itself); `up()` executes for real against that database.
 * `attachments` documents are seeded and read back through a plain `mongodb`
 * driver `MongoClient` connected to the same per-worker test database,
 * bypassing model-level / Prisma schema validation so the pre-migration
 * legacy document shape (no `attachmentType`) can be represented directly —
 * exactly how the migration itself finds them in production.
 *
 * WHY the `exclusive` project: `up()`'s `$runCommandRaw` update matches every
 * document in the `attachments` collection with a missing `attachmentType`,
 * not just documents this file inserted. Sharing a database with the
 * ordinary integration tests would let this file silently backfill (and thus
 * mutate) any legacy-shaped attachment fixture another file in the same
 * worker left behind.
 *
 * Contract under test (implementation-agnostic — asserts observable DB
 * state):
 *  - a legacy attachment with "page" set and no "attachmentType" gets
 *    attachmentType = AttachmentType.WIKI_PAGE;
 *  - a legacy attachment with "page" null and no "attachmentType" gets
 *    attachmentType = AttachmentType.PROFILE_IMAGE;
 *  - an attachment that already has an attachmentType is left untouched,
 *    regardless of its "page" value;
 *  - re-running is a no-op (idempotent).
 */
import type { Collection, Db } from 'mongodb';
import { MongoClient, ObjectId } from 'mongodb';

import { AttachmentType } from '~/server/interfaces/attachment';
import { getTestDbConfig } from '^/test/setup/mongo/test-db-config';

describe('20220613064207-add-attachment-type-to-existing-attachments', () => {
  let migrate: typeof import('./20220613064207-add-attachment-type-to-existing-attachments');
  let client: MongoClient;
  let db: Db;
  let attachments: Collection;

  const attachmentIds: ObjectId[] = [];

  beforeAll(async () => {
    const { mongoUri } = getTestDbConfig();
    if (mongoUri == null) {
      throw new Error('mongoUri is not resolved by the test mongo setup');
    }

    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db();
    attachments = db.collection('attachments');

    migrate = await import(
      './20220613064207-add-attachment-type-to-existing-attachments'
    );
  });

  afterAll(async () => {
    await client.close();
  });

  afterEach(async () => {
    if (attachmentIds.length > 0) {
      await attachments.deleteMany({ _id: { $in: attachmentIds } });
      attachmentIds.length = 0;
    }
  });

  it('sets attachmentType to WIKI_PAGE for a legacy attachment with a page', async () => {
    const id = new ObjectId();
    await attachments.insertOne({
      _id: id,
      page: new ObjectId(),
      fileName: `wiki-page-${id.toHexString()}`,
    });
    attachmentIds.push(id);

    await migrate.up();

    const doc = await attachments.findOne({ _id: id });
    expect(doc?.attachmentType).toBe(AttachmentType.WIKI_PAGE);
  });

  it('sets attachmentType to PROFILE_IMAGE for a legacy attachment with no page', async () => {
    const id = new ObjectId();
    await attachments.insertOne({
      _id: id,
      page: null,
      fileName: `profile-image-${id.toHexString()}`,
    });
    attachmentIds.push(id);

    await migrate.up();

    const doc = await attachments.findOne({ _id: id });
    expect(doc?.attachmentType).toBe(AttachmentType.PROFILE_IMAGE);
  });

  it('leaves an attachment that already has an attachmentType untouched', async () => {
    const id = new ObjectId();
    await attachments.insertOne({
      _id: id,
      page: new ObjectId(),
      fileName: `already-typed-${id.toHexString()}`,
      attachmentType: AttachmentType.PROFILE_IMAGE,
    });
    attachmentIds.push(id);

    await migrate.up();

    // Not overwritten to WIKI_PAGE even though "page" is set
    const doc = await attachments.findOne({ _id: id });
    expect(doc?.attachmentType).toBe(AttachmentType.PROFILE_IMAGE);
  });

  it('is idempotent (re-running does not change already-backfilled values)', async () => {
    const id = new ObjectId();
    await attachments.insertOne({
      _id: id,
      page: new ObjectId(),
      fileName: `idempotent-${id.toHexString()}`,
    });
    attachmentIds.push(id);

    await migrate.up();
    const first = await attachments.findOne({ _id: id });

    await migrate.up();
    const second = await attachments.findOne({ _id: id });

    expect(second?.attachmentType).toBe(first?.attachmentType);
    expect(second?.attachmentType).toBe(AttachmentType.WIKI_PAGE);
  });
});
