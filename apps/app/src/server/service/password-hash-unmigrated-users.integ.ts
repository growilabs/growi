// Contract: design.md "Testing Strategy → Integration（service）". Fixtures are
// marker-scoped so the shared `users` / `externalaccounts` collections are never
// touched beyond them.
import type { Collection } from 'mongodb';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';

import { UserStatus } from '../models/user/conts';
import { listUnmigratedUsersToNudge } from './password-hash-unmigrated-users';

const MARKER = 'pw-unmigrated-users-svc-test';
const markerFilter = { username: { $regex: `^${MARKER}` } };
const externalMarkerFilter = { accountId: { $regex: `^${MARKER}` } };

describe('password-hash-unmigrated-users service', () => {
  let users: Collection;
  let externalAccounts: Collection;

  const seed = async (
    docs: { name: string; fields: Record<string, unknown> }[],
  ): Promise<Record<string, ObjectId>> => {
    const ids: Record<string, ObjectId> = {};
    await users.insertMany(
      docs.map(({ name, fields }) => {
        const _id = new ObjectId();
        ids[name] = _id;
        return { _id, username: `${MARKER}-${name}`, ...fields };
      }),
    );
    return ids;
  };

  const list = (page: number, limit: number) =>
    listUnmigratedUsersToNudge(users, externalAccounts, {
      page,
      limit,
      baseFilter: markerFilter,
    });

  beforeAll(() => {
    users = mongoose.connection.collection('users');
    externalAccounts = mongoose.connection.collection('externalaccounts');
  });

  beforeEach(async () => {
    await users.deleteMany(markerFilter);
    await externalAccounts.deleteMany(externalMarkerFilter);
  });

  afterEach(async () => {
    await users.deleteMany(markerFilter);
    await externalAccounts.deleteMany(externalMarkerFilter);
  });

  it('returns only legacy-only users without an external account, regardless of status (Req 7.1, 7.2, 7.3)', async () => {
    const ids = await seed([
      {
        name: 'legacy-active',
        fields: { status: UserStatus.STATUS_ACTIVE, password: 'p' },
      },
      {
        name: 'legacy-suspended',
        fields: { status: UserStatus.STATUS_SUSPENDED, password: 'p' },
      },
      {
        name: 'legacy-invited',
        fields: { status: UserStatus.STATUS_INVITED, password: 'p' },
      },
      {
        name: 'legacy-external',
        fields: { status: UserStatus.STATUS_ACTIVE, password: 'p' },
      },
      {
        name: 'both',
        fields: {
          status: UserStatus.STATUS_ACTIVE,
          passwordHash: 'h',
          password: 'p',
        },
      },
      {
        name: 'upgraded-only',
        fields: { status: UserStatus.STATUS_ACTIVE, passwordHash: 'h' },
      },
      { name: 'no-password', fields: { status: UserStatus.STATUS_ACTIVE } },
    ]);
    await externalAccounts.insertOne({
      providerType: 'ldap',
      accountId: `${MARKER}-ldap-1`,
      user: ids['legacy-external'],
    });

    const result = await list(1, 20);

    expect(result.users.map((u) => u.username).sort()).toEqual([
      `${MARKER}-legacy-active`,
      `${MARKER}-legacy-invited`,
      `${MARKER}-legacy-suspended`,
    ]);
    expect(result.totalCount).toBe(3);
  });

  it('orders by lastLoginAt desc, never-logged-in last, ties broken by _id (Req 7.5)', async () => {
    const oldest = new Date('2026-01-01T00:00:00.000Z');
    const newest = new Date('2026-03-01T00:00:00.000Z');
    const ids = await seed([
      { name: 'never-a', fields: { password: 'p' } },
      { name: 'old', fields: { password: 'p', lastLoginAt: oldest } },
      { name: 'never-b', fields: { password: 'p', lastLoginAt: null } },
      { name: 'new-a', fields: { password: 'p', lastLoginAt: newest } },
      { name: 'new-b', fields: { password: 'p', lastLoginAt: newest } },
    ]);
    const newTie = [ids['new-a'], ids['new-b']].sort((a, b) =>
      a.toHexString().localeCompare(b.toHexString()),
    );
    const neverTie = [ids['never-a'], ids['never-b']].sort((a, b) =>
      a.toHexString().localeCompare(b.toHexString()),
    );

    const result = await list(1, 20);

    expect(result.users.map((u) => u._id)).toEqual([
      ...newTie.map((id) => id.toHexString()),
      ids.old.toHexString(),
      ...neverTie.map((id) => id.toHexString()),
    ]);
    expect(result.users[2].lastLoginAt).toBe(oldest.toISOString());
    expect(result.users[3].lastLoginAt).toBeNull();
  });

  it('slices by page/limit and reports the total of matching users (Req 7.5, 7.6)', async () => {
    await seed(
      [0, 1, 2, 3, 4].map((i) => ({
        name: `u${i}`,
        fields: {
          password: 'p',
          lastLoginAt: new Date(Date.UTC(2026, 0, 1 + i)),
        },
      })),
    );

    const page2 = await list(2, 2);

    expect(page2.users.map((u) => u.username)).toEqual([
      `${MARKER}-u2`,
      `${MARKER}-u1`,
    ]);
    expect(page2.totalCount).toBe(5);
    expect(page2.page).toBe(2);
    expect(page2.limit).toBe(2);

    const page3 = await list(3, 2);
    expect(page3.users.map((u) => u.username)).toEqual([`${MARKER}-u0`]);
  });

  it('returns only _id/username/email/lastLoginAt and never password fields (Req 4.4, 7.4)', async () => {
    await seed([
      {
        name: 'with-email',
        fields: {
          password: 'secret-legacy-hash',
          email: 'a@example.com',
          lastLoginAt: new Date('2026-02-02T00:00:00.000Z'),
          apiToken: 'tok',
        },
      },
      { name: 'no-email', fields: { password: 'p' } },
    ]);

    const result = await list(1, 20);

    for (const user of result.users) {
      expect(Object.keys(user).sort()).toEqual([
        '_id',
        'email',
        'lastLoginAt',
        'username',
      ]);
    }
    const byName = Object.fromEntries(result.users.map((u) => [u.username, u]));
    expect(byName[`${MARKER}-with-email`].email).toBe('a@example.com');
    expect(byName[`${MARKER}-no-email`].email).toBeNull();
    expect(JSON.stringify(result)).not.toContain('secret-legacy-hash');
  });
});
