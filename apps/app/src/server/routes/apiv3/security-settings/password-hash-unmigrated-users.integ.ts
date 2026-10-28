// Contract: design.md "Testing Strategy", routes integration for
// password-hash-unmigrated-users.integ.ts. admin-required and the apiv3
// response extension are real. The handler lists the whole collection, so marker
// users get a far-future lastLoginAt to sort ahead of any pre-existing user.
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import type { Collection } from 'mongodb';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type { PasswordHashUnmigratedUser } from '~/interfaces/password-hash-status';
import type Crowi from '~/server/crowi';
import { UserStatus } from '~/server/models/user/conts';
import { listUnmigratedUsersToNudge } from '~/server/service/password-hash-unmigrated-users';

import addCustomFunctionToResponse from '../response';
import { getPasswordHashUnmigratedUsersHandlersFactory } from './password-hash-unmigrated-users';

const passthroughMiddleware = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => next();

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => passthroughMiddleware,
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default: () => passthroughMiddleware,
}));

vi.mock('~/server/service/password-hash-unmigrated-users', async () => {
  const actual = await vi.importActual<
    typeof import('~/server/service/password-hash-unmigrated-users')
  >('~/server/service/password-hash-unmigrated-users');
  return {
    ...actual,
    listUnmigratedUsersToNudge: vi.fn(actual.listUnmigratedUsersToNudge),
  };
});

const MARKER = 'pw-unmigrated-users-route-test';
const markerFilter = { username: { $regex: `^${MARKER}` } };
const externalMarkerFilter = { accountId: { $regex: `^${MARKER}` } };

type TestUser = { _id: ObjectId; username: string; admin: boolean };

const adminUser: TestUser = {
  _id: new ObjectId(),
  username: `${MARKER}-admin`,
  admin: true,
};
const nonAdminUser: TestUser = {
  _id: new ObjectId(),
  username: `${MARKER}-member`,
  admin: false,
};

const FUTURE_NEWER = new Date('2999-01-02T00:00:00.000Z');
const FUTURE_OLDER = new Date('2999-01-01T00:00:00.000Z');

describe('GET /password-hash-unmigrated-users', () => {
  let users: Collection;
  let externalAccounts: Collection;
  let app: express.Express;
  let currentUser: TestUser | undefined;

  const seedFixtures = async () => {
    const legacyExternalId = new ObjectId();
    await users.insertMany([
      {
        _id: new ObjectId(),
        username: `${MARKER}-legacy-newer`,
        email: `${MARKER}-newer@example.com`,
        status: UserStatus.STATUS_ACTIVE,
        password: 'p',
        lastLoginAt: FUTURE_NEWER,
      },
      {
        _id: new ObjectId(),
        username: `${MARKER}-legacy-older`,
        status: UserStatus.STATUS_SUSPENDED,
        password: 'p',
        lastLoginAt: FUTURE_OLDER,
      },
      {
        _id: legacyExternalId,
        username: `${MARKER}-legacy-external`,
        status: UserStatus.STATUS_ACTIVE,
        password: 'p',
        lastLoginAt: FUTURE_NEWER,
      },
      {
        _id: new ObjectId(),
        username: `${MARKER}-both`,
        status: UserStatus.STATUS_ACTIVE,
        password: 'p',
        passwordHash: 'h',
        lastLoginAt: FUTURE_NEWER,
      },
    ]);
    await externalAccounts.insertOne({
      providerType: 'ldap',
      accountId: `${MARKER}-ldap-1`,
      user: legacyExternalId,
    });
  };

  const usernamesOf = (body: { users: PasswordHashUnmigratedUser[] }) =>
    body.users.map((u) => u.username);

  beforeAll(() => {
    users = mongoose.connection.collection('users');
    externalAccounts = mongoose.connection.collection('externalaccounts');

    addCustomFunctionToResponse(express);

    const crowi = mock<Crowi>();
    app = express();
    app.use((req, _res, next) => {
      if (currentUser != null) {
        Object.assign(req, { user: currentUser });
      }
      next();
    });
    app.get(
      '/password-hash-unmigrated-users',
      ...getPasswordHashUnmigratedUsersHandlersFactory(crowi),
    );
  });

  beforeEach(async () => {
    currentUser = undefined;
    await users.deleteMany(markerFilter);
    await externalAccounts.deleteMany(externalMarkerFilter);
  });

  afterEach(async () => {
    await users.deleteMany(markerFilter);
    await externalAccounts.deleteMany(externalMarkerFilter);
  });

  it('returns legacy-only users without an external account to an admin, with defaults page=1 limit=20 (Req 4.4, 7.6)', async () => {
    currentUser = adminUser;
    await seedFixtures();

    const res = await request(app).get('/password-hash-unmigrated-users');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['limit', 'page', 'totalCount', 'users'].sort(),
    );
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(20);
    expect(res.body.totalCount).toBeGreaterThanOrEqual(2);

    const markerRows = (res.body.users as PasswordHashUnmigratedUser[]).filter(
      (u) => u.username.startsWith(MARKER),
    );
    expect(markerRows).toEqual([
      {
        _id: expect.any(String),
        username: `${MARKER}-legacy-newer`,
        email: `${MARKER}-newer@example.com`,
        lastLoginAt: FUTURE_NEWER.toISOString(),
      },
      {
        _id: expect.any(String),
        username: `${MARKER}-legacy-older`,
        email: null,
        lastLoginAt: FUTURE_OLDER.toISOString(),
      },
    ]);
    expect(res.text).not.toMatch(/"(password|passwordHash)"\s*:/);
  });

  it('passes page and limit through to the listing (Req 7.6)', async () => {
    currentUser = adminUser;
    await seedFixtures();

    const first = await request(app).get(
      '/password-hash-unmigrated-users?page=1&limit=1',
    );
    const second = await request(app).get(
      '/password-hash-unmigrated-users?page=2&limit=1',
    );

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ page: 1, limit: 1 });
    expect(usernamesOf(first.body)).toEqual([`${MARKER}-legacy-newer`]);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ page: 2, limit: 1 });
    expect(usernamesOf(second.body)).toEqual([`${MARKER}-legacy-older`]);
  });

  it('redirects a non-admin user without returning the list (Req 4.1, 4.2)', async () => {
    currentUser = nonAdminUser;
    await seedFixtures();

    const res = await request(app).get('/password-hash-unmigrated-users');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(res.body?.users).toBeUndefined();
    expect(res.text).not.toContain(MARKER);
  });

  it.each([
    ['page=0'],
    ['limit=0'],
    ['limit=101'],
    ['limit=abc'],
    ['page=abc'],
    ['page=100001'],
    ['page=2&page=3'],
    ['limit=5&limit=6'],
  ])('rejects an invalid query %s with 400', async (query) => {
    currentUser = adminUser;

    const res = await request(app).get(
      `/password-hash-unmigrated-users?${query}`,
    );

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('validation_failed');
    expect(res.body.users).toBeUndefined();
  });

  it('returns 500 with an error code when listing fails (Req 7.8)', async () => {
    currentUser = adminUser;
    vi.mocked(listUnmigratedUsersToNudge).mockRejectedValueOnce(
      new Error('db down'),
    );

    const res = await request(app).get('/password-hash-unmigrated-users');

    expect(res.status).toBe(500);
    expect(res.body.errors[0].code).toBe(
      'password-hash-unmigrated-users-fetch-failed',
    );
    expect(res.body.users).toBeUndefined();
  });
});
