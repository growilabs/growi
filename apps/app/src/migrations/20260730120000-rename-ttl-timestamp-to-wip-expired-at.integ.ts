/**
 * Integration test for the ttlTimestamp -> wipExpiredAt migration.
 *
 * Contract under test (observable DB state):
 *  - the stored value is CONVERTED, not renamed: `ttlTimestamp` held the moment the
 *    page was made WIP and the TTL index supplied the duration, whereas
 *    `wipExpiredAt` is the absolute expiry;
 *  - no page comes out already expired, whatever it went in as: a timestamp older
 *    than one window is still past even after the duration is added, so those get a
 *    full window from the migration instead of feeding the first cleanup run;
 *  - a legacy page that has descendants is exempted (field dropped, no expiry
 *    granted), mirroring makeWip()'s `disableTtl`;
 *  - no page is deleted: orphaned empty placeholders are left for the admin page
 *    tree repair, so "has descendants" is judged against the uncleaned tree;
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

  // Relative to now: a fixture pinned to an absolute instant silently ages into the
  // already-overdue branch and starts passing for the wrong reason.
  const madeWipAt = new Date(Date.now() - 60 * 60 * 1000); // 1h ago: not yet overdue
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
    // A rename would have produced madeWipAt — already past, so the next sweep
    // would have deleted the page completely.
    expect((doc?.wipExpiredAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('re-grants a full window to a page that was already overdue, instead of converting it to a past instant', async () => {
    // The backlog on an instance whose TTL monitor was not reaping: adding the
    // duration to a months-old timestamp still lands in the past.
    const id = track(new ObjectId());
    await pages.insertOne({
      _id: id,
      path: '/mig-long-overdue',
      isEmpty: false,
      wip: true,
      ttlTimestamp: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90d ago
    });

    const before = Date.now();
    await migrate.up(db);

    const expiry = (
      (await pages.findOne({ _id: id }))?.wipExpiredAt as Date
    ).getTime();
    // One whole window measured from the migration, so it is necessarily future.
    expect(expiry).toBeGreaterThanOrEqual(before + EXPIRATION_SECONDS * 1000);
    expect(expiry).toBeLessThanOrEqual(Date.now() + EXPIRATION_SECONDS * 1000);
  });

  it('splits at exactly one expiration window: just-overdue is re-granted, just-inside keeps its real deadline', async () => {
    // Pins where the two branches meet: the boundary could otherwise drift by a
    // whole window with both tests above still green, and drifting it earlier
    // reintroduces the bug for a page overdue by minutes.
    const windowMs = EXPIRATION_SECONDS * 1000;
    const justOverdue = track(new ObjectId());
    const justInside = track(new ObjectId());
    const justInsideTtl = new Date(Date.now() - windowMs + 5 * 60 * 1000);
    await pages.insertMany([
      {
        _id: justOverdue,
        path: '/mig-just-overdue',
        isEmpty: false,
        wip: true,
        ttlTimestamp: new Date(Date.now() - windowMs - 5 * 60 * 1000),
      },
      {
        _id: justInside,
        path: '/mig-just-inside',
        isEmpty: false,
        wip: true,
        ttlTimestamp: justInsideTtl,
      },
    ]);

    const before = Date.now();
    await migrate.up(db);

    const overdueExpiry = (
      (await pages.findOne({ _id: justOverdue }))?.wipExpiredAt as Date
    ).getTime();
    expect(overdueExpiry).toBeGreaterThanOrEqual(before + windowMs);
    expect(overdueExpiry).toBeLessThanOrEqual(Date.now() + windowMs);

    // Still inside its window, so its own deadline stands — no re-grant.
    const insideExpiry = (
      (await pages.findOne({ _id: justInside }))?.wipExpiredAt as Date
    ).getTime();
    expect(insideExpiry).toBe(justInsideTtl.getTime() + windowMs);
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

  it('deletes no page, and exempts a legacy page whose only child is an orphaned empty one', async () => {
    // This migration repairs the expiry field only — removing orphaned placeholders
    // belongs to the admin page tree repair. So the placeholder survives, and since
    // it still counts as a child, its parent is exempted instead of being granted an
    // expiry. That is the safe direction: a migration must never delete pages, which
    // is what this asserts.
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

    expect(await pages.findOne({ _id: ghost })).not.toBeNull();
    const doc = await pages.findOne({ _id: parent });
    // Asserted before the field checks below: on a null doc both of them read
    // undefined and would pass vacuously.
    expect(doc).not.toBeNull();
    expect(doc?.ttlTimestamp).toBeUndefined();
    expect(doc?.wipExpiredAt).toBeUndefined();
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

  it('converts every page when the stream spans more than one batch', async () => {
    // The conversion streams and flushes per batch, so the batch boundary is control
    // flow no other fixture here reaches. The classic bug in that shape is dropping the
    // trailing partial batch, leaving those pages with no expiry at all.
    //
    // Mirrors BATCH_SIZE in the migration. If that grows, raise this — otherwise the
    // stream fits in one batch and this stops testing the boundary.
    const MIGRATION_BATCH_SIZE = 1000;
    const total = MIGRATION_BATCH_SIZE + 1;
    // All overdue, so every page takes the re-grant branch and shares one instant.
    const longOverdue = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const ids = Array.from({ length: total }, () => track(new ObjectId()));
    await pages.insertMany(
      ids.map((_id, i) => ({
        _id,
        path: `/mig-bulk-${i}`,
        isEmpty: false,
        wip: true,
        ttlTimestamp: longOverdue,
      })),
    );

    await migrate.up(db);

    // Counts what was granted, not what is absent: a page left behind by a dropped
    // final batch loses ttlTimestamp to the exemption either way.
    expect(
      await pages.countDocuments({
        _id: { $in: ids },
        wipExpiredAt: { $ne: null },
      }),
    ).toBe(total);
    expect(
      await pages.countDocuments({
        _id: { $in: ids },
        ttlTimestamp: { $ne: null },
      }),
    ).toBe(0);
    // One instant across both batches. Recomputing it per batch would smear these
    // across the run and contradict the expiry time the warning log quotes.
    expect(
      await pages.distinct('wipExpiredAt', { _id: { $in: ids } }),
    ).toHaveLength(1);
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
