/**
 * Integration test for the password-hash format distribution count.
 *
 * Contract under test (implementation-agnostic — asserts observable behavior):
 *  - every user is counted in exactly one of the four formats, decided purely by
 *    which credential fields hold a non-empty value;
 *  - `legacyOnly` is additionally split into its ACTIVE / non-ACTIVE parts, because
 *    only the ACTIVE part blocks the cleanup, and `legacyOnly` equals their sum;
 *  - a credential scrubbed to an empty string (what `statusDelete` left behind on
 *    older builds) counts as ABSENT, so such a user is `noPassword` — mis-counting
 *    it as `legacyOnly` would make the cleanup look permanently blocked.
 *
 * Fixtures are seeded via the raw driver with precisely-set fields, and every count
 * is scoped to this test's marker so it never sees documents from other integ tests
 * sharing the `users` collection.
 *
 * Requires a real MongoDB connection (wired by vitest.workspace.mts integ setup).
 */
import type { Collection } from 'mongodb';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

import { UserStatus } from '../models/user/conts';

const MARKER = 'pwhash-distribution-test';
const markerFilter = { username: { $regex: `^${MARKER}` } };

describe('countPasswordHashFormatDistribution', () => {
  let collection: Collection;
  let countPasswordHashFormatDistribution: typeof import('./password-hash-format-distribution').countPasswordHashFormatDistribution;

  beforeAll(async () => {
    ({ countPasswordHashFormatDistribution } = await import(
      './password-hash-format-distribution'
    ));
    collection = mongoose.connection.collection('users');
    // Transforming this module's import graph can exceed the 10s default when the
    // whole suite runs in parallel on a cold cache.
  }, 60_000);

  beforeEach(async () => {
    await collection.deleteMany(markerFilter);
  });

  afterEach(async () => {
    await collection.deleteMany(markerFilter);
  });

  afterAll(async () => {
    await collection.deleteMany(markerFilter);
  });

  it('classifies every user into exactly one format and splits legacyOnly by status', async () => {
    await collection.insertMany([
      // upgradedOnly x2
      {
        _id: new ObjectId(),
        username: `${MARKER}-upgraded-0`,
        status: UserStatus.STATUS_ACTIVE,
        passwordHash: 'scrypt$hash-0',
      },
      {
        _id: new ObjectId(),
        username: `${MARKER}-upgraded-1`,
        status: UserStatus.STATUS_SUSPENDED,
        passwordHash: 'scrypt$hash-1',
      },
      // both x3 — the cleanup's target set
      {
        _id: new ObjectId(),
        username: `${MARKER}-both-0`,
        status: UserStatus.STATUS_ACTIVE,
        password: 'legacy-sha256',
        passwordHash: 'scrypt$hash-2',
      },
      {
        _id: new ObjectId(),
        username: `${MARKER}-both-1`,
        status: UserStatus.STATUS_ACTIVE,
        password: 'legacy-sha256',
        passwordHash: 'scrypt$hash-3',
      },
      {
        _id: new ObjectId(),
        username: `${MARKER}-both-2`,
        status: UserStatus.STATUS_SUSPENDED,
        password: 'legacy-sha256',
        passwordHash: 'scrypt$hash-4',
      },
      // legacyOnly ACTIVE x2 — these are what block the cleanup
      {
        _id: new ObjectId(),
        username: `${MARKER}-legacy-active-0`,
        status: UserStatus.STATUS_ACTIVE,
        password: 'legacy-sha256',
      },
      {
        _id: new ObjectId(),
        username: `${MARKER}-legacy-active-1`,
        status: UserStatus.STATUS_ACTIVE,
        password: 'legacy-sha256',
      },
      // legacyOnly non-ACTIVE x1 — counted, never blocking
      {
        _id: new ObjectId(),
        username: `${MARKER}-legacy-invited-0`,
        status: UserStatus.STATUS_INVITED,
        password: 'legacy-sha256',
      },
      // noPassword x1 — external-auth-only
      {
        _id: new ObjectId(),
        username: `${MARKER}-nopassword-0`,
        status: UserStatus.STATUS_ACTIVE,
      },
    ]);

    const result = await countPasswordHashFormatDistribution(
      collection,
      markerFilter,
    );

    expect(result).toEqual({
      upgradedOnly: 2,
      both: 3,
      legacyOnly: 3,
      legacyOnlyActive: 2,
      legacyOnlyNonActive: 1,
      noPassword: 1,
    });
  });

  it('counts a scrubbed empty-string credential as absent, not as legacyOnly', async () => {
    await collection.insertMany([
      // Deleted-style user scrubbed by statusDelete on an older build: the field
      // EXISTS but holds ''. Reading it as present would classify this as
      // legacyOnly and make the cleanup look blocked forever.
      {
        _id: new ObjectId(),
        username: `${MARKER}-deleted-0`,
        status: UserStatus.STATUS_DELETED,
        password: '',
      },
      {
        _id: new ObjectId(),
        username: `${MARKER}-deleted-1`,
        status: UserStatus.STATUS_DELETED,
        password: '',
        passwordHash: '',
      },
    ]);

    const result = await countPasswordHashFormatDistribution(
      collection,
      markerFilter,
    );

    expect(result.noPassword).toBe(2);
    expect(result.legacyOnly).toBe(0);
    expect(result.legacyOnlyActive).toBe(0);
    expect(result.both).toBe(0);
    expect(result.upgradedOnly).toBe(0);
  });

  it('returns all-zero counts when the scope matches nothing', async () => {
    const result = await countPasswordHashFormatDistribution(
      collection,
      markerFilter,
    );

    expect(result).toEqual({
      upgradedOnly: 0,
      both: 0,
      legacyOnly: 0,
      legacyOnlyActive: 0,
      legacyOnlyNonActive: 0,
      noPassword: 0,
    });
  });
});
