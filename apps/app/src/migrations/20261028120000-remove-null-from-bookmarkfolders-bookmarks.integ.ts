/**
 * Integration test for the bookmarkfolders.bookmarks null-element cleanup.
 *
 * Contract under test (asserts observable DB state and Prisma readability):
 *  - a folder whose `bookmarks` array contains null elements becomes readable
 *    by Prisma, keeping its valid bookmark ids in their original order;
 *  - a folder whose `bookmarks` field itself is null becomes an empty array,
 *    so later `$pull` / `$addToSet` on it succeed;
 *  - folders already in a valid shape (valid array, field missing) are left
 *    completely untouched, and their presence does not stop the cleanup of
 *    the others;
 *  - re-running is a no-op (idempotent).
 *
 * Legacy documents are inserted via the raw driver so that Mongoose does not
 * cast or default the `bookmarks` field.
 */
import type { Collection } from 'mongodb';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

import { prisma } from '~/utils/prisma';

describe('remove-null-from-bookmarkfolders-bookmarks', () => {
  let collection: Collection;
  let migrate: typeof import('./20261028120000-remove-null-from-bookmarkfolders-bookmarks');
  const ownerId = new ObjectId();

  beforeAll(async () => {
    migrate = await import(
      './20261028120000-remove-null-from-bookmarkfolders-bookmarks'
    );
    collection = mongoose.connection.collection('bookmarkfolders');
  });

  afterEach(async () => {
    await collection.deleteMany({ owner: ownerId });
  });

  it('makes a folder with null elements readable by Prisma, keeping valid ids in order', async () => {
    const bookmarkA = new ObjectId();
    const bookmarkB = new ObjectId();
    const mixedId = new ObjectId();
    const nullOnlyId = new ObjectId();
    await collection.insertMany([
      {
        _id: mixedId,
        name: 'mixed',
        owner: ownerId,
        bookmarks: [bookmarkA, null, bookmarkB, null],
        __v: 0,
      },
      {
        _id: nullOnlyId,
        name: 'null-only',
        owner: ownerId,
        bookmarks: [null, null],
        __v: 0,
      },
    ]);
    const findOwnerFolders = () =>
      prisma.bookmarkfolders.findMany({
        where: { ownerId: ownerId.toString() },
      });
    // The fixture must reproduce the reported failure, or the test proves nothing
    await expect(findOwnerFolders()).rejects.toThrow(/bookmarkIds/);

    await migrate.up();

    const folders = await findOwnerFolders();
    const idsByFolder = Object.fromEntries(
      folders.map((f) => [f.id, f.bookmarkIds]),
    );
    expect(idsByFolder).toEqual({
      [mixedId.toString()]: [bookmarkA.toString(), bookmarkB.toString()],
      [nullOnlyId.toString()]: [],
    });
  });

  it('turns a null bookmarks field into an empty array, without touching an array that holds valid ids', async () => {
    const bookmark = new ObjectId();
    const nullFieldId = new ObjectId();
    const mixedId = new ObjectId();
    await collection.insertMany([
      {
        _id: nullFieldId,
        name: 'null-field',
        owner: ownerId,
        bookmarks: null,
        __v: 0,
      },
      {
        _id: mixedId,
        name: 'mixed',
        owner: ownerId,
        bookmarks: [bookmark, null],
        __v: 0,
      },
    ]);

    await migrate.up();

    const nullField = await collection.findOne({ _id: nullFieldId });
    expect(nullField?.bookmarks).toEqual([]);
    const mixed = await collection.findOne({ _id: mixedId });
    expect(mixed?.bookmarks).toEqual([bookmark]);
    // Writes that previously failed on the null field now succeed
    const added = new ObjectId();
    await collection.updateOne(
      { _id: nullFieldId },
      { $addToSet: { bookmarks: added } },
    );
    expect(
      (await collection.findOne({ _id: nullFieldId }))?.bookmarks,
    ).toEqual([added]);
  });

  it('leaves folders already in a valid shape untouched and still cleans the rest', async () => {
    const bookmark = new ObjectId();
    const untouched = [
      {
        _id: new ObjectId(),
        name: 'valid',
        owner: ownerId,
        bookmarks: [bookmark],
        __v: 0,
      },
      { _id: new ObjectId(), name: 'no-field', owner: ownerId, __v: 0 },
    ];
    const brokenId = new ObjectId();
    await collection.insertMany([
      ...untouched,
      {
        _id: brokenId,
        name: 'broken',
        owner: ownerId,
        bookmarks: [null],
        __v: 0,
      },
    ]);

    await migrate.up();

    for (const doc of untouched) {
      expect(await collection.findOne({ _id: doc._id })).toEqual(doc);
    }
    const broken = await collection.findOne({ _id: brokenId });
    expect(broken?.bookmarks).toEqual([]);
    // Leaving a missing field as is relies on Prisma reading it as an empty list
    const folders = await prisma.bookmarkfolders.findMany({
      where: { ownerId: ownerId.toString() },
    });
    expect(
      Object.fromEntries(folders.map((f) => [f.name, f.bookmarkIds])),
    ).toEqual({
      valid: [bookmark.toString()],
      'no-field': [],
      broken: [],
    });
  });

  it('fails instead of reporting success when a folder cannot be cleaned', async () => {
    const id = new ObjectId();
    // A non-numeric __v makes the update fail for this document only
    await collection.insertOne({
      _id: id,
      name: 'uncleanable',
      owner: ownerId,
      bookmarks: [null],
      __v: 'not-a-number',
    });

    await expect(migrate.up()).rejects.toThrow();

    const folder = await collection.findOne({ _id: id });
    expect(folder?.bookmarks).toEqual([null]);
  });

  it('is idempotent (re-running does not change the cleaned folder)', async () => {
    const bookmark = new ObjectId();
    const id = new ObjectId();
    await collection.insertOne({
      _id: id,
      name: 'idempotent',
      owner: ownerId,
      bookmarks: [null, bookmark],
      __v: 0,
    });

    await migrate.up();
    const first = await collection.findOne({ _id: id });

    await migrate.up();
    const second = await collection.findOne({ _id: id });

    expect(second).toEqual(first);
    expect(second?.bookmarks).toEqual([bookmark]);
  });
});
