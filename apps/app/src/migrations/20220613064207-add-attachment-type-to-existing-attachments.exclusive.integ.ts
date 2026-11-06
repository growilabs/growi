/**
 * `attachments` are seeded and read back through a plain `mongodb` driver
 * client (not mongoose / Prisma) so the pre-migration legacy shape (no
 * `attachmentType`) can be represented without schema validation.
 *
 * Runs in the `exclusive` project because `up()` backfills every attachment
 * missing `attachmentType`, which would mutate fixtures other files in a
 * shared database leave behind.
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
