// Contract: design.md "Testing Strategy → Integration（routes）". admin-required
// and the apiv3 response extension are real; counts are asserted as deltas of
// marker-seeded fixtures because the handler counts the whole collection.
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import type { Collection } from 'mongodb';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type { PasswordHashFormatCounts } from '~/interfaces/password-hash-status';
import type Crowi from '~/server/crowi';
import { UserStatus } from '~/server/models/user/conts';
import { countPasswordHashFormats } from '~/server/service/legacy-password-cleanup';

import addCustomFunctionToResponse from '../response';
import { getPasswordHashStatusHandlersFactory } from './password-hash-status';

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

vi.mock('~/server/middlewares/add-activity', () => ({
  generateAddActivityMiddleware:
    () => (_req: Request, res: Response, next: NextFunction) => {
      res.locals.activity = { _id: '507f1f77bcf86cd799439011' };
      next();
    },
}));

vi.mock('~/server/service/legacy-password-cleanup', async () => {
  const actual = await vi.importActual<
    typeof import('~/server/service/legacy-password-cleanup')
  >('~/server/service/legacy-password-cleanup');
  return {
    ...actual,
    countPasswordHashFormats: vi.fn(actual.countPasswordHashFormats),
    unsetLegacyPasswordOfMigratedUsers: vi.fn(
      actual.unsetLegacyPasswordOfMigratedUsers,
    ),
  };
});

const MARKER = 'legacy-pw-cleanup-route-test';
const markerFilter = { username: { $regex: `^${MARKER}` } };

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

const FIXTURES: readonly Record<string, unknown>[] = [
  { status: UserStatus.STATUS_ACTIVE, passwordHash: 'h' },
  { status: UserStatus.STATUS_ACTIVE, passwordHash: 'h', password: 'p' },
  { status: UserStatus.STATUS_SUSPENDED, passwordHash: 'h', password: 'p' },
  { status: UserStatus.STATUS_ACTIVE, password: 'p' },
  { status: UserStatus.STATUS_ACTIVE, password: 'p' },
  { status: UserStatus.STATUS_SUSPENDED, password: 'p' },
  { status: UserStatus.STATUS_ACTIVE },
];
// upgradedOnly 1, both 2, legacyOnly active 2 / nonActive 1, noPassword 1
const EXPECTED_DELTA: PasswordHashFormatCounts = {
  upgradedOnly: 1,
  both: 2,
  legacyOnly: { active: 2, nonActive: 1 },
  noPassword: 1,
};

const HASH_FIELD_PATTERN = /"(password|passwordHash|user|users)"\s*:/;

describe('security-setting legacy password cleanup routes', () => {
  let collection: Collection;
  let app: express.Express;
  let currentUser: TestUser | undefined;

  const seedFixtures = async () => {
    await collection.insertMany(
      FIXTURES.map((fields, i) => ({
        _id: new ObjectId(),
        username: `${MARKER}-${i}`,
        ...fields,
      })),
    );
  };

  beforeAll(() => {
    collection = mongoose.connection.collection('users');

    addCustomFunctionToResponse(express);

    const crowi = mock<Crowi>();
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (currentUser != null) {
        Object.assign(req, { user: currentUser });
      }
      next();
    });
    app.get(
      '/password-hash-status',
      ...getPasswordHashStatusHandlersFactory(crowi),
    );
  });

  beforeEach(async () => {
    currentUser = undefined;
    await collection.deleteMany(markerFilter);
  });

  afterEach(async () => {
    await collection.deleteMany(markerFilter);
  });

  describe('GET /password-hash-status', () => {
    it('returns only the counts, reflecting seeded users, for an admin (Req 1.1, 4.4)', async () => {
      currentUser = adminUser;
      const before = await request(app).get('/password-hash-status');
      expect(before.status).toBe(200);

      await seedFixtures();
      const after = await request(app).get('/password-hash-status');

      expect(after.status).toBe(200);
      expect(Object.keys(after.body)).toEqual(['counts']);
      const prev: PasswordHashFormatCounts = before.body.counts;
      const next: PasswordHashFormatCounts = after.body.counts;
      expect({
        upgradedOnly: next.upgradedOnly - prev.upgradedOnly,
        both: next.both - prev.both,
        legacyOnly: {
          active: next.legacyOnly.active - prev.legacyOnly.active,
          nonActive: next.legacyOnly.nonActive - prev.legacyOnly.nonActive,
        },
        noPassword: next.noPassword - prev.noPassword,
      }).toEqual(EXPECTED_DELTA);
      expect(Object.keys(next).sort()).toEqual(
        ['both', 'legacyOnly', 'noPassword', 'upgradedOnly'].sort(),
      );
      expect(Object.keys(next.legacyOnly).sort()).toEqual([
        'active',
        'nonActive',
      ]);
      expect(after.text).not.toMatch(HASH_FIELD_PATTERN);
    });

    it('redirects a non-admin user without returning counts (Req 4.1, 4.2)', async () => {
      currentUser = nonAdminUser;
      await seedFixtures();

      const res = await request(app).get('/password-hash-status');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
      expect(res.body?.counts).toBeUndefined();
      expect(res.text).not.toMatch(/counts/);
    });

    it('returns 500 with an error code when counting fails (Req 1.5)', async () => {
      currentUser = adminUser;
      vi.mocked(countPasswordHashFormats).mockRejectedValueOnce(
        new Error('db down'),
      );

      const res = await request(app).get('/password-hash-status');

      expect(res.status).toBe(500);
      expect(res.body.errors[0].code).toBe('password-hash-status-fetch-failed');
      expect(res.body.counts).toBeUndefined();
    });
  });
});
