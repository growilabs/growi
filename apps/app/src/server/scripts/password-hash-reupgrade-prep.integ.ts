/**
 * Integration test for the password-hash re-upgrade prep standalone script.
 *
 * Contract under test (implementation-agnostic — asserts observable behavior):
 *  - runReupgradePrep() $unsets `passwordHash` from every `both` user
 *    (passwordHash + password present) REGARDLESS of status, leaving their legacy
 *    `password` intact so they drop back to `legacyOnly` and re-migrate on the
 *    next login (the fix for the downgrade → change-password → re-upgrade stale-
 *    passwordHash resurrection hole);
 *  - it leaves `legacyOnly` (password only) and `upgradedOnly` (passwordHash only)
 *    users untouched — only the ambiguous `both` state can hold a stale hash;
 *  - it is idempotent: a second run finds zero `both` users and writes nothing.
 *
 * Fixtures are seeded via the raw driver (not the Mongoose User model) with
 * precisely-set fields, matching the cleanup / status-migration integ test style.
 *
 * Requires a real MongoDB connection (wired by vitest.workspace.mts integ setup).
 */
import type { Collection } from 'mongodb';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

import { UserStatus } from '../models/user/conts';

const MARKER = 'pwhash-reupgrade-test';
// Scope every count/write to this test's marker-seeded fixtures so the run never
// touches the `users` collection shared with other integ tests in this worker.
const markerFilter = { username: { $regex: `^${MARKER}` } };

describe('password-hash re-upgrade prep script', () => {
  let collection: Collection;
  let runReupgradePrep: typeof import('./password-hash-reupgrade-prep').runReupgradePrep;

  beforeAll(async () => {
    ({ runReupgradePrep } = await import('./password-hash-reupgrade-prep'));
    collection = mongoose.connection.collection('users');
    // Transforming this module's import graph can exceed the 10s default when the
    // whole suite runs in parallel on a cold cache.
  }, 60_000);

  // Clear marker fixtures on BOTH sides: the collection is shared per worker, so a
  // doc surviving a previous run (or an aborted one) would inflate this test's counts.
  beforeEach(async () => {
    await collection.deleteMany({ username: { $regex: `^${MARKER}` } });
  });

  afterEach(async () => {
    await collection.deleteMany({ username: { $regex: `^${MARKER}` } });
  });

  afterAll(async () => {
    await collection.deleteMany({ username: { $regex: `^${MARKER}` } });
  });

  it('unsets passwordHash on every `both` user regardless of status, and leaves legacyOnly / upgradedOnly untouched', async () => {
    const docs: Record<string, unknown>[] = [
      // both + ACTIVE: the target — passwordHash may be stale after an old-build
      // password change, so it must be removed.
      {
        _id: new ObjectId(),
        username: `${MARKER}-both-active`,
        status: UserStatus.STATUS_ACTIVE,
        passwordHash: 'scrypt$hash-active',
        password: 'legacy-sha256-active',
      },
      // both + NON-ACTIVE: still a target — every `both` user keeps a live legacy
      // `password`, so removing passwordHash never locks anyone out (NOT status-scoped).
      {
        _id: new ObjectId(),
        username: `${MARKER}-both-suspended`,
        status: UserStatus.STATUS_SUSPENDED,
        passwordHash: 'scrypt$hash-suspended',
        password: 'legacy-sha256-suspended',
      },
      // legacyOnly: no passwordHash to remove — untouched.
      {
        _id: new ObjectId(),
        username: `${MARKER}-legacy`,
        status: UserStatus.STATUS_ACTIVE,
        password: 'legacy-sha256',
      },
      // upgradedOnly: no legacy password, so it cannot hold a stale hash — untouched.
      // (These are downgrade-prep's concern, not this script's.)
      {
        _id: new ObjectId(),
        username: `${MARKER}-upgraded`,
        status: UserStatus.STATUS_ACTIVE,
        passwordHash: 'scrypt$hash-upgraded',
      },
    ];
    await collection.insertMany(docs);

    const result = await runReupgradePrep(collection, markerFilter);

    expect(result.both).toBe(2);
    expect(result.unset).toBe(2);

    // both users: passwordHash removed, legacy password retained → now legacyOnly.
    const both = await collection
      .find({ username: { $regex: `^${MARKER}-both` } })
      .toArray();
    expect(both).toHaveLength(2);
    for (const doc of both) {
      expect(doc.passwordHash).toBeUndefined();
      expect(typeof doc.password).toBe('string');
    }

    // legacyOnly: unchanged.
    const legacy = await collection.findOne({ username: `${MARKER}-legacy` });
    expect(legacy?.password).toBe('legacy-sha256');
    expect(legacy?.passwordHash).toBeUndefined();

    // upgradedOnly: completely untouched (still has its passwordHash).
    const upgraded = await collection.findOne({
      username: `${MARKER}-upgraded`,
    });
    expect(upgraded?.passwordHash).toBe('scrypt$hash-upgraded');
    expect(upgraded?.password).toBeUndefined();
  });

  it('is idempotent: a second run finds no `both` users and writes nothing', async () => {
    await collection.insertMany([
      {
        _id: new ObjectId(),
        username: `${MARKER}-both-0`,
        status: UserStatus.STATUS_ACTIVE,
        passwordHash: 'scrypt$hash-0',
        password: 'legacy-sha256-0',
      },
    ]);

    const first = await runReupgradePrep(collection, markerFilter);
    expect(first.both).toBe(1);
    expect(first.unset).toBe(1);

    const second = await runReupgradePrep(collection, markerFilter);
    expect(second.both).toBe(0);
    expect(second.unset).toBe(0);
  });
});
