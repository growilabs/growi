/**
 * Integration test for the password-hash status migration.
 *
 * Contract under test (implementation-agnostic — asserts observable behavior):
 *  - up() classifies every user document into exactly one of the four
 *    dual-field categories and reports the count of each:
 *      upgradedOnly (passwordHash only), both (both fields),
 *      legacyOnly (password only), noPassword (neither field);
 *  - up() performs NO writes — every user document is byte-for-byte identical
 *    before and after the run (this is a read-only progress report).
 *
 * The four categories are seeded via the raw driver (not the Mongoose User
 * model) with precisely-set fields, so a miscategorization is detectable via
 * deliberately-distinct per-category counts.
 *
 * Requires a real MongoDB connection (wired by vitest.workspace.mts integ setup;
 * prisma is bound to the same per-worker DB as mongoose by test/setup/prisma.ts,
 * so the migration's prisma-based counts hit the collection mongoose seeded).
 */
import type { Collection } from 'mongodb';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

// Distinct per-category counts so any miscategorization changes a total.
const EXPECTED = {
  upgradedOnly: 2,
  both: 1,
  legacyOnly: 3,
  noPassword: 4,
} as const;

const MARKER = 'pwhash-status-test';
// Scope every count to this test's marker-seeded fixtures so the run never
// depends on (or wipes) the `users` collection shared with other integ tests.
const markerFilter = { username: { $regex: `^${MARKER}` } };

describe('password-hash-status migration', () => {
  let collection: Collection;
  let migrate: typeof import('./20260724000001-password-hash-status');

  beforeAll(async () => {
    migrate = await import('./20260724000001-password-hash-status');
    collection = mongoose.connection.collection('users');

    // reportPasswordHashFormatDistribution() is called with the marker scope, so
    // the seeded fixtures are the only documents counted — marker-scoped counts
    // equal EXPECTED regardless of what other tests left in the shared collection.
    const docs: Record<string, unknown>[] = [];
    // upgradedOnly: passwordHash present, password absent
    for (let i = 0; i < EXPECTED.upgradedOnly; i++) {
      docs.push({
        _id: new ObjectId(),
        username: `${MARKER}-upgraded-${i}`,
        passwordHash: 'scrypt$hash',
      });
    }
    // both: both fields present
    for (let i = 0; i < EXPECTED.both; i++) {
      docs.push({
        _id: new ObjectId(),
        username: `${MARKER}-both-${i}`,
        passwordHash: 'scrypt$hash',
        password: 'legacy-sha256',
      });
    }
    // legacyOnly: password present, passwordHash absent
    for (let i = 0; i < EXPECTED.legacyOnly; i++) {
      docs.push({
        _id: new ObjectId(),
        username: `${MARKER}-legacy-${i}`,
        password: 'legacy-sha256',
      });
    }
    // noPassword: neither credential field holds a real value. Besides the
    // plain neither-field case, an empty-string / null credential MUST also
    // classify as noPassword (statusDelete scrubs deleted users to
    // `password: ''`, and older docs may carry it) — NOT as legacyOnly.
    docs.push({
      // neither field present
      _id: new ObjectId(),
      username: `${MARKER}-nopass-neither`,
    });
    docs.push({
      // empty-string password (scrubbed deleted user, older build)
      _id: new ObjectId(),
      username: `${MARKER}-nopass-emptystr`,
      password: '',
    });
    docs.push({
      // null password
      _id: new ObjectId(),
      username: `${MARKER}-nopass-null`,
      password: null,
    });
    docs.push({
      // empty-string passwordHash, no password
      _id: new ObjectId(),
      username: `${MARKER}-nopass-emptyhash`,
      passwordHash: '',
    });
    await collection.insertMany(docs);
  });

  afterAll(async () => {
    await collection.deleteMany({ username: { $regex: `^${MARKER}` } });
  });

  it('reports the correct count for each of the four hash-format categories', async () => {
    const counts =
      await migrate.reportPasswordHashFormatDistribution(markerFilter);

    expect(counts).toEqual(EXPECTED);
  });

  it('does not modify any user document (read-only)', async () => {
    // Marker-scoped snapshot before/after: any added/removed/changed field on a
    // fixture is detected by deep equality. Sort by _id for a stable ordering.
    const before = await collection
      .find(markerFilter)
      .sort({ _id: 1 })
      .toArray();

    await migrate.reportPasswordHashFormatDistribution(markerFilter);

    const after = await collection
      .find(markerFilter)
      .sort({ _id: 1 })
      .toArray();
    expect(after).toEqual(before);
  });

  it('runs under the migrate-mongo up(db, client) call signature without a stack overflow (regression)', async () => {
    // migrate-mongo invokes the migration as `up(db, client)`. `up()` MUST ignore
    // those args: forwarding the Db object as a query filter previously
    // AND-combined it into the count query and BSON-serialized the whole Db →
    // `RangeError: Maximum call stack size exceeded` (broke every migrate-mongo
    // run and, transitively, launch-dev + all integ setup). This calls the real
    // entry point exactly as migrate-mongo does.
    const db = mongoose.connection.db;
    const client = mongoose.connection.getClient();

    await expect(migrate.up(db, client)).resolves.toBeUndefined();
  });
});
