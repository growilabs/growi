/**
 * Integration test for the commentreactions index migration.
 *
 * Contract under test (observable DB state, Requirements 2.4, 2.5, 10.2):
 *  - up creates the unique (comment, user, emoji) index and the page index under the
 *    names declared by Prisma's `map`;
 *  - pre-existing duplicates are removed keeping the oldest, so the unique index builds;
 *  - up is safe to re-run and safe on a missing collection;
 *  - down drops both indexes and is safe on a missing collection.
 */
import type { Collection, Db } from 'mongodb';
import mongoose, { Types } from 'mongoose';

import { replaceMongoDbName } from '^/test/setup/mongo/utils';

describe('add-indexes-to-commentreactions', () => {
  const { ObjectId } = Types;
  const COLLECTION_NAME = 'commentreactions';
  const UNIQUE_INDEX_NAME = 'comment_1_user_1_emoji_1';
  const PAGE_INDEX_NAME = 'page_1';

  let db: Db;
  let collection: Collection;
  let migrate: typeof import('./20261016120000-add-indexes-to-commentreactions');

  const commentId = new ObjectId();
  const pageId = new ObjectId();
  const userId = new ObjectId();

  const dropCollection = async () => {
    const found = await db
      .listCollections({ name: COLLECTION_NAME }, { nameOnly: true })
      .toArray();
    if (found.length > 0) {
      await db.dropCollection(COLLECTION_NAME);
    }
  };

  // ObjectId embeds creation time, so `seconds` controls which doc is "oldest"
  const reaction = (
    seconds: number,
    overrides: { comment?: Types.ObjectId; emoji?: string } = {},
  ) => ({
    _id: ObjectId.createFromTime(seconds),
    comment: overrides.comment ?? commentId,
    page: pageId,
    user: userId,
    emoji: overrides.emoji ?? 'thumbsup',
    createdAt: new Date(seconds * 1000),
    __v: 0,
  });

  const readIndexes = async () => {
    const indexes = await collection.indexes();
    return new Map(indexes.map((index) => [index.name, index]));
  };

  const readIds = async () => {
    const docs = await collection
      .find({}, { projection: { _id: 1 } })
      .toArray();
    return docs.map((doc) => doc._id.toString()).sort();
  };

  beforeAll(async () => {
    // The migration calls mongoose.connect(getMongoUri()), which must name the same
    // database as the worker's existing connection or mongoose refuses to reconnect.
    const mongoUri = process.env.MONGO_URI;
    if (mongoUri != null) {
      vi.stubEnv(
        'MONGO_URI',
        replaceMongoDbName(mongoUri, mongoose.connection.name),
      );
    }
    migrate = await import('./20261016120000-add-indexes-to-commentreactions');
    db = mongoose.connection.db as Db;
    collection = db.collection(COLLECTION_NAME);
  });

  // The template DB may already hold the collection with indexes (migrations run at
  // template creation), so every scenario starts from a missing collection.
  beforeEach(dropCollection);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await dropCollection();
  });

  it('creates the unique and page indexes with the names Prisma declares', async () => {
    await migrate.up();

    const indexes = await readIndexes();
    const unique = indexes.get(UNIQUE_INDEX_NAME);
    expect(unique?.key).toEqual({ comment: 1, user: 1, emoji: 1 });
    expect(unique?.unique).toBe(true);
    const page = indexes.get(PAGE_INDEX_NAME);
    expect(page?.key).toEqual({ page: 1 });
    expect(page?.unique).not.toBe(true);
  });

  it('makes the unique index reject a second reaction of the same (comment, user, emoji)', async () => {
    await migrate.up();

    await collection.insertOne(reaction(1000));
    await expect(collection.insertOne(reaction(2000))).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('keeps only the oldest of duplicated reactions and leaves the others untouched', async () => {
    const oldest = reaction(1000);
    const newer = reaction(2000);
    const newest = reaction(3000);
    const otherEmoji = reaction(2500, { emoji: 'heart' });
    const otherComment = reaction(2600, { comment: new ObjectId() });
    // Inserted out of order to prove "oldest" is decided by _id, not insertion order
    await collection.insertMany([
      newer,
      oldest,
      newest,
      otherEmoji,
      otherComment,
    ]);

    await migrate.up();

    expect(await readIds()).toEqual(
      [oldest._id, otherEmoji._id, otherComment._id]
        .map((id) => id.toString())
        .sort(),
    );
    expect((await readIndexes()).has(UNIQUE_INDEX_NAME)).toBe(true);
  });

  it('succeeds when the collection does not exist yet', async () => {
    await expect(migrate.up()).resolves.not.toThrow();

    const indexes = await readIndexes();
    expect(indexes.has(UNIQUE_INDEX_NAME)).toBe(true);
    expect(indexes.has(PAGE_INDEX_NAME)).toBe(true);
  });

  it('succeeds and keeps both indexes and data when run twice', async () => {
    await collection.insertOne(reaction(1000));

    await migrate.up();
    await migrate.up();

    const indexes = await readIndexes();
    expect(indexes.has(UNIQUE_INDEX_NAME)).toBe(true);
    expect(indexes.has(PAGE_INDEX_NAME)).toBe(true);
    expect(await collection.countDocuments()).toBe(1);
  });

  it('down drops both indexes', async () => {
    await migrate.up();

    await migrate.down(db);

    const indexes = await readIndexes();
    expect(indexes.has(UNIQUE_INDEX_NAME)).toBe(false);
    expect(indexes.has(PAGE_INDEX_NAME)).toBe(false);
  });

  it('down succeeds when the collection does not exist', async () => {
    await expect(migrate.down(db)).resolves.not.toThrow();
  });
});
