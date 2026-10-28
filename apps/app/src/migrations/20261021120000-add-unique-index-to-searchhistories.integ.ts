/**
 * Integration test for the searchhistories unique index migration.
 *
 * Contract under test (observable DB state, Requirements 3.2, 7.5):
 *  - after `up`, a unique index named like the `@@unique(map:)` in schema.prisma exists;
 *  - duplicated (user, keyword) rows are reduced to the most recently searched one
 *    before the index is built, so the build does not fail on legacy data;
 *  - re-running `up` is a no-op, and `down` removes the index;
 *  - the generated Prisma client can read and write the collection.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Collection, Db, Document } from 'mongodb';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

import { prisma } from '~/utils/prisma';

const COLLECTION_NAME = 'searchhistories';
const INDEX_NAME = 'user_1_keyword_1';
const PRISMA_SCHEMA_PATH = path.resolve(
  import.meta.dirname,
  '../../prisma/schema.prisma',
);

describe('add-unique-index-to-searchhistories', () => {
  let db: Db;
  let collection: Collection;
  let migrate: typeof import('./20261021120000-add-unique-index-to-searchhistories');

  const findIndex = async () => {
    const indexes = await collection.indexes().catch(() => [] as Document[]);
    return indexes.find((index) => index.name === INDEX_NAME);
  };

  beforeAll(async () => {
    migrate = await import('./20261021120000-add-unique-index-to-searchhistories');
    db = mongoose.connection.db as unknown as Db;
    collection = db.collection(COLLECTION_NAME);
  });

  afterEach(async () => {
    await collection.deleteMany({});
    await collection.dropIndex(INDEX_NAME).catch(() => {});
  });

  it('creates a unique index on (user, keyword) whose name matches schema.prisma', async () => {
    await migrate.up(db);

    const index = await findIndex();
    expect(index?.unique).toBe(true);
    expect(index?.key).toEqual({ user: 1, keyword: 1 });

    const schema = await fs.readFile(PRISMA_SCHEMA_PATH, 'utf-8');
    expect(schema).toContain(`@@unique([userId, keyword], map: "${INDEX_NAME}")`);
  });

  it('keeps only the most recently searched row of each duplicated (user, keyword)', async () => {
    const user = new ObjectId();
    const otherUser = new ObjectId();
    const newest = new ObjectId();
    await collection.insertMany([
      { user, keyword: 'dup', lastSearchedAt: new Date('2026-01-01') },
      { _id: newest, user, keyword: 'dup', lastSearchedAt: new Date('2026-03-01') },
      { user, keyword: 'dup', lastSearchedAt: new Date('2026-02-01') },
      { user, keyword: 'Dup', lastSearchedAt: new Date('2026-01-01') },
      { user: otherUser, keyword: 'dup', lastSearchedAt: new Date('2026-01-01') },
    ]);

    await migrate.up(db);

    const rows = await collection.find({ user, keyword: 'dup' }).toArray();
    expect(rows.map((row) => row._id)).toEqual([newest]);
    expect(await collection.countDocuments({ user, keyword: 'Dup' })).toBe(1);
    expect(await collection.countDocuments({ user: otherUser })).toBe(1);
    expect((await findIndex())?.unique).toBe(true);
  });

  it('is a no-op when run again', async () => {
    await migrate.up(db);
    await migrate.up(db);

    expect((await findIndex())?.unique).toBe(true);
  });

  it('removes the index on down, and tolerates a missing collection', async () => {
    await migrate.up(db);
    await migrate.down(db);
    expect(await findIndex()).toBeUndefined();

    await collection.drop().catch(() => {});
    await expect(migrate.down(db)).resolves.toBeUndefined();
  });

  describe('Prisma client', () => {
    it('reads and writes searchhistories and rejects a duplicate (user, keyword)', async () => {
      await migrate.up(db);
      const userId = new ObjectId().toString();
      const lastSearchedAt = new Date('2026-04-01T00:00:00.000Z');

      const created = await prisma.searchhistories.create({
        data: { userId, keyword: 'wiki', lastSearchedAt },
      });

      const found = await prisma.searchhistories.findUnique({
        where: { id: created.id },
      });
      expect(found).toMatchObject({ userId, keyword: 'wiki', lastSearchedAt });
      expect(await collection.findOne({ _id: new ObjectId(created.id) })).toMatchObject({
        user: new ObjectId(userId),
        keyword: 'wiki',
      });

      await expect(
        prisma.searchhistories.create({
          data: { userId, keyword: 'wiki', lastSearchedAt },
        }),
      ).rejects.toThrow();
    });
  });
});
