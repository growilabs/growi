/**
 * Integration test for the ttlTimestamp -> wipExpiredAt migration.
 *
 * Contract under test (observable DB state):
 *  - the stored value is CONVERTED, not renamed: `ttlTimestamp` held the moment the
 *    page was made WIP and the TTL index supplied the duration, whereas
 *    `wipExpiredAt` is the absolute expiry. A straight rename would leave every
 *    existing WIP page already expired, and the cleanup cron would delete them all
 *    on its first run;
 *  - a legacy page that has descendants is exempted (field dropped, no expiry
 *    granted), mirroring makeWip()'s `disableTtl`;
 *  - the orphaned-empty-page sweep runs first, so "has descendants" is judged
 *    against the cleaned tree;
 *  - the TTL index is replaced by a plain one;
 *  - re-running is a no-op, and down() round-trips.
 *
 * Legacy documents are inserted with the raw driver so nothing is auto-populated —
 * that is exactly the pre-migration state being repaired.
 */
import type { Collection, Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

const TTL_INDEX_NAME = 'ttlTimestamp_1';
const WIP_EXPIRED_AT_INDEX_NAME = 'wipExpiredAt_1';
const EXPIRATION_SECONDS = 172800; // 48h — written to configs below

describe('rename-ttl-timestamp-to-wip-expired-at', () => {
  let db: Db;
  let pages: Collection;
  let configs: Collection;
  let migrate: typeof import('./20260730120000-rename-ttl-timestamp-to-wip-expired-at');

  const madeWipAt = new Date('2026-01-01T00:00:00.000Z');
  const expectedExpiry = new Date(
    madeWipAt.getTime() + EXPIRATION_SECONDS * 1000,
  );

  const createdPageIds: ObjectId[] = [];
  const track = (id: ObjectId) => {
    createdPageIds.push(id);
    return id;
  };

  beforeAll(async () => {
    migrate = await import('./20260730120000-rename-ttl-timestamp-to-wip-expired-at');
    db = mongoose.connection.db as unknown as Db;
    pages = db.collection('pages');
    configs = db.collection('configs');

    await configs.insertOne({
      key: 'app:wipPageExpirationSeconds',
      value: JSON.stringify(EXPIRATION_SECONDS),
    });
  });

  afterAll(async () => {
    await configs.deleteOne({ key: 'app:wipPageExpirationSeconds' });
  });

  afterEach(async () => {
    if (createdPageIds.length > 0) {
      await pages.deleteMany({ _id: { $in: createdPageIds } });
      createdPageIds.length = 0;
    }
    await pages.dropIndex(TTL_INDEX_NAME).catch(() => {});
    await pages.dropIndex(WIP_EXPIRED_AT_INDEX_NAME).catch(() => {});
  });

  it('converts the stored value instead of renaming it, so the page is not already expired', async () => {
    const id = track(new ObjectId());
    await pages.insertOne({
      _id: id,
      path: '/mig-childless-wip',
      isEmpty: false,
      wip: true,
      ttlTimestamp: madeWipAt,
    });

    await migrate.up(db);

    const doc = await pages.findOne({ _id: id });
    expect(doc?.ttlTimestamp).toBeUndefined();
    expect((doc?.wipExpiredAt as Date).getTime()).toBe(expectedExpiry.getTime());
    // The whole point: a rename would have produced madeWipAt, i.e. long past.
    expect((doc?.wipExpiredAt as Date).getTime()).toBeGreaterThan(
      madeWipAt.getTime(),
    );
  });

  it('exempts a legacy page that has descendants (no expiry granted)', async () => {
    const parent = track(new ObjectId());
    const child = track(new ObjectId());
    await pages.insertMany([
      {
        _id: parent,
        path: '/mig-wip-parent',
        isEmpty: false,
        wip: true,
        ttlTimestamp: madeWipAt,
      },
      { _id: child, path: '/mig-wip-parent/kid', isEmpty: false, parent },
    ]);

    await migrate.up(db);

    const doc = await pages.findOne({ _id: parent });
    expect(doc?.ttlTimestamp).toBeUndefined();
    expect(doc?.wipExpiredAt).toBeUndefined();
  });

  it('sweeps orphaned empty pages before judging descendants', async () => {
    // The only child is a childless empty placeholder, which the sweep removes.
    // Judged after the sweep, this page IS childless and must get an expiry —
    // running the conversion first would exempt it forever.
    const parent = track(new ObjectId());
    const ghost = track(new ObjectId());
    await pages.insertMany([
      {
        _id: parent,
        path: '/mig-wip-stale',
        isEmpty: false,
        wip: true,
        ttlTimestamp: madeWipAt,
      },
      { _id: ghost, path: '/mig-wip-stale/ghost', isEmpty: true, parent },
    ]);

    await migrate.up(db);

    expect(await pages.findOne({ _id: ghost })).toBeNull();
    const doc = await pages.findOne({ _id: parent });
    expect((doc?.wipExpiredAt as Date).getTime()).toBe(expectedExpiry.getTime());
  });

  it('replaces the TTL index with a plain index', async () => {
    await pages.createIndex(
      { ttlTimestamp: 1 },
      { name: TTL_INDEX_NAME, expireAfterSeconds: EXPIRATION_SECONDS },
    );

    await migrate.up(db);

    const indexes = await pages.indexes();
    expect(indexes.some((i) => i.name === TTL_INDEX_NAME)).toBe(false);
    const wipIndex = indexes.find((i) => i.name === WIP_EXPIRED_AT_INDEX_NAME);
    expect(wipIndex).toBeDefined();
    expect(wipIndex?.expireAfterSeconds).toBeUndefined();
    // Must match the mongoose schema declaration, or whichever of the two creates
    // it second fails with IndexOptionsConflict.
    expect(wipIndex?.sparse).toBe(true);
  });

  it('brings an existing wipExpiredAt index up to the expected options', async () => {
    // A non-sparse index of this name can already exist (an earlier run, or
    // mongoose autoIndex before this change). Leaving it alone would make the
    // schema's own createIndexes call conflict on every boot.
    await pages.createIndex(
      { wipExpiredAt: 1 },
      { name: WIP_EXPIRED_AT_INDEX_NAME },
    );

    await migrate.up(db);

    const wipIndex = (await pages.indexes()).find(
      (i) => i.name === WIP_EXPIRED_AT_INDEX_NAME,
    );
    expect(wipIndex?.sparse).toBe(true);
  });

  it('is idempotent', async () => {
    const id = track(new ObjectId());
    await pages.insertOne({
      _id: id,
      path: '/mig-idempotent',
      isEmpty: false,
      wip: true,
      ttlTimestamp: madeWipAt,
    });

    await migrate.up(db);
    const afterFirst = await pages.findOne({ _id: id });
    await migrate.up(db);
    const afterSecond = await pages.findOne({ _id: id });

    expect((afterSecond?.wipExpiredAt as Date).getTime()).toBe(
      (afterFirst?.wipExpiredAt as Date).getTime(),
    );
    expect(afterSecond?.ttlTimestamp).toBeUndefined();
  });

  it('down() restores the original stored value and the TTL index', async () => {
    const id = track(new ObjectId());
    await pages.insertOne({
      _id: id,
      path: '/mig-roundtrip',
      isEmpty: false,
      wip: true,
      ttlTimestamp: madeWipAt,
    });

    await migrate.up(db);
    await migrate.down(db);

    const doc = await pages.findOne({ _id: id });
    expect(doc?.wipExpiredAt).toBeUndefined();
    expect((doc?.ttlTimestamp as Date).getTime()).toBe(madeWipAt.getTime());

    const indexes = await pages.indexes();
    const ttlIndex = indexes.find((i) => i.name === TTL_INDEX_NAME);
    expect(ttlIndex?.expireAfterSeconds).toBe(EXPIRATION_SECONDS);
  });
});
