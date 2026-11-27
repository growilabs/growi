/**
 * Integration test for the unmigrated-user listing.
 *
 * Contract under test (implementation-agnostic — asserts observable behavior):
 *  - only users holding an old-format credential and no new one are listed;
 *  - rows carry the fields an administrator needs to decide who to approach:
 *    username, email, last login, status, and whether the user has an external
 *    account;
 *  - the order is newest login first, with never-logged-in users last — the point
 *    of the screen is that a recent login on an unmigrated user means they are not
 *    signing in with their password, so those rows must surface first;
 *  - `totalCount` counts the whole set, not the page, so paging is navigable.
 *
 * Fixtures are seeded via the raw driver and every query is scoped to this test's
 * marker, so it never sees documents from other integ tests sharing the
 * collections.
 *
 * Requires a real MongoDB connection (wired by vitest.workspace.mts integ setup).
 */
import type { Collection } from 'mongodb';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

import { UserStatus } from '../models/user/conts';

const MARKER = 'pwhash-unmigrated-test';
const markerFilter = { username: { $regex: `^${MARKER}` } };

describe('listPasswordHashUnmigratedUsers', () => {
  let users: Collection;
  let externalAccounts: Collection;
  let listPasswordHashUnmigratedUsers: typeof import('./password-hash-unmigrated-users').listPasswordHashUnmigratedUsers;

  const seededIds: Record<string, ObjectId> = {};

  beforeAll(async () => {
    ({ listPasswordHashUnmigratedUsers } = await import(
      './password-hash-unmigrated-users'
    ));
    users = mongoose.connection.collection('users');
    externalAccounts = mongoose.connection.collection('externalaccounts');
    // Transforming this module's import graph can exceed the 10s default when the
    // whole suite runs in parallel on a cold cache.
  }, 60_000);

  const cleanup = async () => {
    const ids = Object.values(seededIds);
    await users.deleteMany(markerFilter);
    if (ids.length > 0) {
      await externalAccounts.deleteMany({ user: { $in: ids } });
    }
  };

  beforeEach(cleanup);
  afterEach(cleanup);

  const seed = async () => {
    const mk = (name: string) => {
      const id = new ObjectId();
      seededIds[name] = id;
      return id;
    };

    await users.insertMany([
      // unmigrated, logged in recently -> not using the local password
      {
        _id: mk('recent'),
        username: `${MARKER}-recent`,
        email: 'recent@example.com',
        status: UserStatus.STATUS_ACTIVE,
        password: 'legacy-sha256',
        lastLoginAt: new Date('2026-10-01T00:00:00Z'),
      },
      // unmigrated, logged in long ago -> prompting them can still work
      {
        _id: mk('old'),
        username: `${MARKER}-old`,
        email: 'old@example.com',
        status: UserStatus.STATUS_ACTIVE,
        password: 'legacy-sha256',
        lastLoginAt: new Date('2025-01-01T00:00:00Z'),
      },
      // unmigrated, never logged in
      {
        _id: mk('never'),
        username: `${MARKER}-never`,
        status: UserStatus.STATUS_SUSPENDED,
        password: 'legacy-sha256',
      },
      // already migrated -> must not be listed
      {
        _id: mk('migrated'),
        username: `${MARKER}-migrated`,
        status: UserStatus.STATUS_ACTIVE,
        password: 'legacy-sha256',
        passwordHash: 'scrypt$hash',
        lastLoginAt: new Date('2026-10-02T00:00:00Z'),
      },
      // scrypt only -> must not be listed
      {
        _id: mk('upgraded'),
        username: `${MARKER}-upgraded`,
        status: UserStatus.STATUS_ACTIVE,
        passwordHash: 'scrypt$hash',
      },
    ]);

    // Only the recently-logged-in one holds an external account.
    await externalAccounts.insertOne({
      _id: new ObjectId(),
      user: seededIds.recent,
      providerType: 'ldap',
      accountId: `${MARKER}-ldap`,
    });
  };

  it('lists only unmigrated users, newest login first, with the fields needed to act', async () => {
    await seed();

    const result = await listPasswordHashUnmigratedUsers(
      users,
      externalAccounts,
      { page: 1, limit: 20, baseFilter: markerFilter },
    );

    expect(result.totalCount).toBe(3);
    expect(result.users.map((u) => u.username)).toEqual([
      `${MARKER}-recent`,
      `${MARKER}-old`,
      `${MARKER}-never`,
    ]);

    const recent = result.users[0];
    expect(recent.email).toBe('recent@example.com');
    expect(recent.lastLoginAt).toBe('2026-10-01T00:00:00.000Z');
    expect(recent.status).toBe(UserStatus.STATUS_ACTIVE);
    // The whole reason this user needs explaining: recent login, still unmigrated.
    expect(recent.hasExternalAccount).toBe(true);

    const never = result.users[2];
    expect(never.lastLoginAt).toBeNull();
    expect(never.email).toBeNull();
    expect(never.hasExternalAccount).toBe(false);
    expect(never.status).toBe(UserStatus.STATUS_SUSPENDED);
  });

  it('pages through the set while reporting the full total', async () => {
    await seed();

    const page1 = await listPasswordHashUnmigratedUsers(
      users,
      externalAccounts,
      { page: 1, limit: 2, baseFilter: markerFilter },
    );
    const page2 = await listPasswordHashUnmigratedUsers(
      users,
      externalAccounts,
      { page: 2, limit: 2, baseFilter: markerFilter },
    );

    // The total must describe the whole set, or the pager cannot size itself.
    expect(page1.totalCount).toBe(3);
    expect(page2.totalCount).toBe(3);
    expect(page1.users).toHaveLength(2);
    expect(page2.users).toHaveLength(1);
    expect(page2.users[0].username).toBe(`${MARKER}-never`);
  });

  it('returns an empty page when nobody is unmigrated', async () => {
    const result = await listPasswordHashUnmigratedUsers(
      users,
      externalAccounts,
      { page: 1, limit: 20, baseFilter: markerFilter },
    );

    expect(result.totalCount).toBe(0);
    expect(result.users).toEqual([]);
  });
});
