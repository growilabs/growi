/**
 * Integration test for the users createdAt/updatedAt backfill migration.
 *
 * Contract under test (implementation-agnostic — asserts observable DB state):
 *  - a legacy user missing both timestamps gets createdAt = ObjectId generation
 *    time and updatedAt = createdAt;
 *  - a user missing only updatedAt gets updatedAt = its existing createdAt
 *    (createdAt untouched);
 *  - a user that already has both is left completely untouched;
 *  - re-running is a no-op (idempotent).
 *
 * Legacy documents are inserted via the raw driver (not the Mongoose User model)
 * so that no timestamps are auto-populated — this is exactly the "predates the
 * timestamps schema" state the migration exists to repair.
 *
 * Requires a real MongoDB connection (wired by vitest.workspace.mts integ setup;
 * prisma is bound to the same per-worker DB as mongoose by test/setup/prisma.ts).
 */
import type { Collection } from 'mongodb';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

describe('backfill-users-timestamps', () => {
  let collection: Collection;
  let migrate: typeof import('./20260721103639-backfill-users-timestamps');
  const createdIds: ObjectId[] = [];

  beforeAll(async () => {
    migrate = await import('./20260721103639-backfill-users-timestamps');
    collection = mongoose.connection.collection('users');
  });

  afterEach(async () => {
    if (createdIds.length > 0) {
      await collection.deleteMany({ _id: { $in: createdIds } });
      createdIds.length = 0;
    }
  });

  it('backfills a legacy user missing both timestamps (createdAt from _id, updatedAt from createdAt)', async () => {
    // Arrange: legacy user document with NO createdAt / updatedAt
    const id = new ObjectId();
    await collection.insertOne({ _id: id, username: 'legacy-no-timestamps' });
    createdIds.push(id);

    // Act
    await migrate.up();

    // Assert
    const doc = await collection.findOne({ _id: id });
    expect(doc?.createdAt).toBeInstanceOf(Date);
    // ObjectId embeds its generation time (second precision) — an exact fact
    expect((doc?.createdAt as Date).getTime()).toBe(id.getTimestamp().getTime());
    expect(doc?.updatedAt).toBeInstanceOf(Date);
    expect((doc?.updatedAt as Date).getTime()).toBe(
      (doc?.createdAt as Date).getTime(),
    );
  });

  it('backfills only updatedAt from the existing createdAt when createdAt is present', async () => {
    const id = new ObjectId();
    const createdAt = new Date('2020-01-01T00:00:00.000Z');
    await collection.insertOne({
      _id: id,
      username: 'legacy-has-createdat',
      createdAt,
    });
    createdIds.push(id);

    await migrate.up();

    const doc = await collection.findOne({ _id: id });
    // createdAt must be unchanged
    expect((doc?.createdAt as Date).getTime()).toBe(createdAt.getTime());
    // updatedAt filled from createdAt
    expect((doc?.updatedAt as Date).getTime()).toBe(createdAt.getTime());
  });

  it('leaves a user that already has both timestamps untouched', async () => {
    const id = new ObjectId();
    const createdAt = new Date('2020-01-01T00:00:00.000Z');
    const updatedAt = new Date('2021-06-15T12:00:00.000Z');
    await collection.insertOne({
      _id: id,
      username: 'has-both-timestamps',
      createdAt,
      updatedAt,
    });
    createdIds.push(id);

    await migrate.up();

    const doc = await collection.findOne({ _id: id });
    expect((doc?.createdAt as Date).getTime()).toBe(createdAt.getTime());
    expect((doc?.updatedAt as Date).getTime()).toBe(updatedAt.getTime());
  });

  it('is idempotent (re-running does not change the filled values)', async () => {
    const id = new ObjectId();
    await collection.insertOne({ _id: id, username: 'idempotent-user' });
    createdIds.push(id);

    await migrate.up();
    const first = await collection.findOne({ _id: id });

    await migrate.up();
    const second = await collection.findOne({ _id: id });

    expect((second?.createdAt as Date).getTime()).toBe(
      (first?.createdAt as Date).getTime(),
    );
    expect((second?.updatedAt as Date).getTime()).toBe(
      (first?.updatedAt as Date).getTime(),
    );
  });
});
