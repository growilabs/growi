/**
 * Integration test for the password-hash cleanup standalone script.
 *
 * Contract under test (implementation-agnostic — asserts observable behavior):
 *  - runPasswordHashCleanup() aborts (aborted=true) WITHOUT writing anything when
 *    any ACTIVE legacyOnly user (password only, no passwordHash) still exists, and
 *    reports the blocking legacyOnly count (Req 3.4);
 *  - a NON-ACTIVE legacyOnly user (suspended / invited / registered / deleted)
 *    cannot be compelled to log in, so its lazy migration can never be relied on
 *    to happen: it must NOT block the cleanup forever — it is only reported
 *    (legacyOnlyNonActive). (Such a user CAN still authenticate; status is only
 *    consulted after login, for the redirect.);
 *  - when no ACTIVE legacyOnly user exists, it $unsets the legacy `password` field
 *    from every `both` user (passwordHash + password) REGARDLESS of status, leaves
 *    `passwordHash` intact, leaves `upgradedOnly` (passwordHash only) users
 *    untouched, and reports how many documents were unset (Req 3.3).
 *
 * Fixtures are seeded via the raw driver (not the Mongoose User model) with
 * precisely-set fields, matching the status-migration integ test style.
 *
 * Requires a real MongoDB connection (wired by vitest.workspace.mts integ setup).
 */
import type { Collection } from 'mongodb';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

import { UserStatus } from '../models/user/conts';

const MARKER = 'pwhash-cleanup-test';
// Scope every count/write to this test's marker-seeded fixtures so the run never
// touches the `users` collection shared with other integ tests in this worker.
const markerFilter = { username: { $regex: `^${MARKER}` } };

describe('password-hash cleanup script', () => {
  let collection: Collection;
  let runPasswordHashCleanup: typeof import('./password-hash-cleanup').runPasswordHashCleanup;

  beforeAll(async () => {
    ({ runPasswordHashCleanup } = await import('./password-hash-cleanup'));
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
    // Clear only this test's marker-scoped fixtures (never the whole collection).
    await collection.deleteMany({ username: { $regex: `^${MARKER}` } });
  });

  afterAll(async () => {
    await collection.deleteMany({ username: { $regex: `^${MARKER}` } });
  });

  describe('when ACTIVE legacyOnly users still exist (Req 3.4)', () => {
    it('aborts, reports the legacyOnly count, and modifies no document', async () => {
      const legacyOnlyCount = 2;
      const docs: Record<string, unknown>[] = [];
      // legacyOnly + ACTIVE: not migrated, but can still log in and migrate lazily
      for (let i = 0; i < legacyOnlyCount; i++) {
        docs.push({
          _id: new ObjectId(),
          username: `${MARKER}-legacy-${i}`,
          status: UserStatus.STATUS_ACTIVE,
          password: 'legacy-sha256',
        });
      }
      // both: a fully-migrated user that would normally be cleaned up — it must
      // stay untouched because the run aborts.
      docs.push({
        _id: new ObjectId(),
        username: `${MARKER}-both-0`,
        status: UserStatus.STATUS_ACTIVE,
        passwordHash: 'scrypt$hash',
        password: 'legacy-sha256',
      });
      await collection.insertMany(docs);

      const before = await collection
        .find(markerFilter)
        .sort({ _id: 1 })
        .toArray();

      const result = await runPasswordHashCleanup(collection, markerFilter);

      expect(result.aborted).toBe(true);
      expect(result.legacyOnly).toBe(legacyOnlyCount);
      expect(result.legacyOnlyNonActive).toBe(0);
      expect(result.unset).toBe(0);

      // No document changed — the both-field user still has its `password`.
      const after = await collection
        .find(markerFilter)
        .sort({ _id: 1 })
        .toArray();
      expect(after).toEqual(before);
    });
  });

  describe('when the remaining legacyOnly users are NON-ACTIVE (Req 3.3, 3.4)', () => {
    it('does NOT abort: a user who cannot log in can never migrate lazily, so it only gets reported', async () => {
      const docs: Record<string, unknown>[] = [
        // legacyOnly users that can never log in → must NOT block the cleanup.
        {
          _id: new ObjectId(),
          username: `${MARKER}-legacy-suspended`,
          status: UserStatus.STATUS_SUSPENDED,
          password: 'legacy-sha256',
        },
        {
          _id: new ObjectId(),
          username: `${MARKER}-legacy-invited`,
          status: UserStatus.STATUS_INVITED,
          password: 'legacy-sha256',
        },
        // both + ACTIVE: the normal cleanup target.
        {
          _id: new ObjectId(),
          username: `${MARKER}-both-active`,
          status: UserStatus.STATUS_ACTIVE,
          passwordHash: 'scrypt$hash-active',
          password: 'legacy-sha256',
        },
        // both + NON-ACTIVE: cleaning a suspended user's legacy hash is correct
        // and desirable, so the $unset is NOT scoped to active users.
        {
          _id: new ObjectId(),
          username: `${MARKER}-both-suspended`,
          status: UserStatus.STATUS_SUSPENDED,
          passwordHash: 'scrypt$hash-suspended',
          password: 'legacy-sha256',
        },
      ];
      await collection.insertMany(docs);

      const result = await runPasswordHashCleanup(collection, markerFilter);

      expect(result.aborted).toBe(false);
      expect(result.legacyOnly).toBe(0);
      expect(result.legacyOnlyNonActive).toBe(2);
      // Both `both` users are cleaned, whatever their status.
      expect(result.unset).toBe(2);

      const both = await collection
        .find({ username: { $regex: `^${MARKER}-both` } })
        .toArray();
      expect(both).toHaveLength(2);
      for (const doc of both) {
        expect(doc.password).toBeUndefined();
        expect(typeof doc.passwordHash).toBe('string');
      }

      // The non-active legacyOnly users keep their legacy credential (they are
      // not `both`, so the cleanup never touches them).
      const legacy = await collection
        .find({ username: { $regex: `^${MARKER}-legacy` } })
        .toArray();
      expect(legacy).toHaveLength(2);
      for (const doc of legacy) {
        expect(doc.password).toBe('legacy-sha256');
      }
    });
  });

  describe('when the only remaining "legacy" docs are scrubbed deleted users (Req 3.3, 3.4)', () => {
    it('does NOT abort: an empty-string `password` (from statusDelete) reads as absent, not legacyOnly', async () => {
      const bothCount = 2;
      const upgradedOnlyCount = 1;
      const docs: Record<string, unknown>[] = [];
      for (let i = 0; i < bothCount; i++) {
        docs.push({
          _id: new ObjectId(),
          username: `${MARKER}-both-${i}`,
          status: UserStatus.STATUS_ACTIVE,
          passwordHash: `scrypt$hash-both-${i}`,
          password: 'legacy-sha256',
        });
      }
      for (let i = 0; i < upgradedOnlyCount; i++) {
        docs.push({
          _id: new ObjectId(),
          username: `${MARKER}-upgraded-${i}`,
          status: UserStatus.STATUS_ACTIVE,
          passwordHash: `scrypt$hash-upgraded-${i}`,
        });
      }
      // Deleted-style user scrubbed by statusDelete on an older build: the
      // `password` field STILL EXISTS but holds '' — it must count as absent,
      // otherwise it is mis-classified as legacyOnly and the run aborts forever.
      docs.push({
        _id: new ObjectId(),
        username: `${MARKER}-deleted-0`,
        status: UserStatus.STATUS_DELETED,
        password: '',
      });
      await collection.insertMany(docs);

      const result = await runPasswordHashCleanup(collection, markerFilter);

      expect(result.aborted).toBe(false);
      expect(result.legacyOnly).toBe(0);
      expect(result.legacyOnlyNonActive).toBe(0);
      expect(result.unset).toBe(bothCount);

      // both users: legacy password removed, scrypt passwordHash retained.
      const both = await collection
        .find({ username: { $regex: `^${MARKER}-both` } })
        .toArray();
      expect(both).toHaveLength(bothCount);
      for (const doc of both) {
        expect(doc.password).toBeUndefined();
        expect(typeof doc.passwordHash).toBe('string');
      }
    });
  });

  describe('when all users are migrated (Req 3.3)', () => {
    it('unsets password on both-field users, keeps passwordHash, leaves upgradedOnly untouched', async () => {
      const bothCount = 3;
      const upgradedOnlyCount = 2;
      const docs: Record<string, unknown>[] = [];
      for (let i = 0; i < bothCount; i++) {
        docs.push({
          _id: new ObjectId(),
          username: `${MARKER}-both-${i}`,
          status: UserStatus.STATUS_ACTIVE,
          passwordHash: `scrypt$hash-both-${i}`,
          password: 'legacy-sha256',
        });
      }
      for (let i = 0; i < upgradedOnlyCount; i++) {
        docs.push({
          _id: new ObjectId(),
          username: `${MARKER}-upgraded-${i}`,
          status: UserStatus.STATUS_ACTIVE,
          passwordHash: `scrypt$hash-upgraded-${i}`,
        });
      }
      await collection.insertMany(docs);

      const result = await runPasswordHashCleanup(collection, markerFilter);

      expect(result.aborted).toBe(false);
      expect(result.legacyOnly).toBe(0);
      expect(result.legacyOnlyNonActive).toBe(0);
      expect(result.unset).toBe(bothCount);

      // both users: password removed, passwordHash retained.
      const both = await collection
        .find({ username: { $regex: `^${MARKER}-both` } })
        .toArray();
      expect(both).toHaveLength(bothCount);
      for (const doc of both) {
        expect(doc.password).toBeUndefined();
        expect(typeof doc.passwordHash).toBe('string');
      }

      // upgradedOnly users: completely untouched.
      const upgraded = await collection
        .find({ username: { $regex: `^${MARKER}-upgraded` } })
        .toArray();
      expect(upgraded).toHaveLength(upgradedOnlyCount);
      for (const doc of upgraded) {
        expect(doc.password).toBeUndefined();
        expect(typeof doc.passwordHash).toBe('string');
      }
    });
  });
});
