// Contract: design.md "Testing Strategy", routes integration. admin-required
// and the apiv3 response extension are real; counts are asserted as deltas of
// marker-seeded fixtures because the handler counts the whole collection.
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import type { Collection } from 'mongodb';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import { SupportedAction } from '~/interfaces/activity';
import type { PasswordHashFormatCounts } from '~/interfaces/password-hash-status';
import type Crowi from '~/server/crowi';
import { UserStatus } from '~/server/models/user/conts';
import {
  countPasswordHashFormats,
  unsetLegacyPasswordOfMigratedUsers,
} from '~/server/service/legacy-password-cleanup';
import loggerFactory from '~/utils/logger';

import addCustomFunctionToResponse from '../response';
import { deleteLegacyPasswordsHandlersFactory } from './delete-legacy-passwords';
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

const ACTIVITY_ID = '507f1f77bcf86cd799439011';

vi.mock('~/server/middlewares/add-activity', () => ({
  generateAddActivityMiddleware:
    () => (_req: Request, res: Response, next: NextFunction) => {
      res.locals.activity = { _id: ACTIVITY_ID };
      next();
    },
}));

// loggerFactory runs at module top level, so the shared instance must be
// swapped before the handler module is imported.
vi.mock('~/utils/logger', () => {
  const mockLogger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  return {
    default: vi.fn().mockReturnValue(mockLogger),
  };
});

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

const getMockLoggerInfo = () =>
  vi.mocked(vi.mocked(loggerFactory)('test').info);
const getMockLoggerError = () =>
  vi.mocked(vi.mocked(loggerFactory)('test').error);

const HASH_FIELD_PATTERN = /"(password|passwordHash|user|users)"\s*:/;

describe('security-setting legacy password cleanup routes', () => {
  let collection: Collection;
  let app: express.Express;
  let currentUser: TestUser | undefined;
  const activityEmit = vi.fn();

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

    const crowi = mock<Crowi>({ events: { activity: { emit: activityEmit } } });
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
    app.delete(
      '/legacy-passwords',
      ...deleteLegacyPasswordsHandlersFactory(crowi),
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

  describe('DELETE /legacy-passwords', () => {
    it('unsets the legacy password of migrated users, emits the delete activity and logs operator and count (Req 2.1, 2.3, 2.4, 4.3, 4.5)', async () => {
      currentUser = adminUser;
      await seedFixtures();
      const markerDocsBefore = await collection
        .find(markerFilter)
        .sort({ username: 1 })
        .toArray();

      const res = await request(app).delete('/legacy-passwords');

      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toEqual(['unsetCount']);
      expect(typeof res.body.unsetCount).toBe('number');
      expect(res.body.unsetCount).toBeGreaterThanOrEqual(EXPECTED_DELTA.both);

      // fixtures 1 and 2 are the "both" users (ACTIVE and SUSPENDED); every
      // other marker user is unchanged, incl. ACTIVE legacy-only ones
      const bothUsernames = [`${MARKER}-1`, `${MARKER}-2`];
      const markerDocsAfter = await collection
        .find(markerFilter)
        .sort({ username: 1 })
        .toArray();
      expect(markerDocsAfter).toEqual(
        markerDocsBefore.map((doc) => {
          if (!bothUsernames.includes(doc.username)) {
            return doc;
          }
          const { password: _password, ...rest } = doc;
          return rest;
        }),
      );
      for (const doc of markerDocsAfter.filter((d) =>
        bothUsernames.includes(d.username),
      )) {
        expect(doc).not.toHaveProperty('password');
        expect(doc).toHaveProperty('passwordHash', 'h');
      }

      expect(activityEmit).toHaveBeenCalledWith('update', ACTIVITY_ID, {
        action: SupportedAction.ACTION_ADMIN_LEGACY_PASSWORD_DELETE,
      });

      const logged = getMockLoggerInfo().mock.calls.map((args) =>
        args.map(String).join(' '),
      );
      expect(
        logged.some(
          (line) =>
            line.includes(adminUser._id.toString()) &&
            line.includes(adminUser.username) &&
            line.includes(`unsetCount=${res.body.unsetCount}`),
        ),
      ).toBe(true);
    });

    it('still succeeds and emits the delete activity when nothing is unset (Req 2.6)', async () => {
      currentUser = adminUser;
      vi.mocked(unsetLegacyPasswordOfMigratedUsers).mockResolvedValueOnce({
        unset: 0,
      });

      const res = await request(app).delete('/legacy-passwords');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ unsetCount: 0 });
      expect(activityEmit).toHaveBeenCalledWith('update', ACTIVITY_ID, {
        action: SupportedAction.ACTION_ADMIN_LEGACY_PASSWORD_DELETE,
      });
      expect(
        getMockLoggerInfo().mock.calls.some((args) =>
          args.map(String).join(' ').includes('unsetCount=0'),
        ),
      ).toBe(true);
    });

    it('still returns the deleted count and logs the error when emitting the activity fails (Req 2.10)', async () => {
      currentUser = adminUser;
      vi.mocked(unsetLegacyPasswordOfMigratedUsers).mockResolvedValueOnce({
        unset: 2,
      });
      activityEmit.mockImplementationOnce(() => {
        throw new Error('emit failed');
      });

      const res = await request(app).delete('/legacy-passwords');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ unsetCount: 2 });
      expect(
        getMockLoggerError().mock.calls.some((args) =>
          args.some(
            (arg) => arg instanceof Error && arg.message === 'emit failed',
          ),
        ),
      ).toBe(true);
    });

    it('redirects a non-admin user without changing data or emitting (Req 4.1, 4.2)', async () => {
      currentUser = nonAdminUser;
      await seedFixtures();
      const markerDocsBefore = await collection
        .find(markerFilter)
        .sort({ username: 1 })
        .toArray();

      const res = await request(app).delete('/legacy-passwords');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
      expect(
        await collection.find(markerFilter).sort({ username: 1 }).toArray(),
      ).toEqual(markerDocsBefore);
      expect(activityEmit).not.toHaveBeenCalled();
    });

    it('returns 500 with an error code and does not emit when unsetting fails (Req 2.7)', async () => {
      currentUser = adminUser;
      vi.mocked(unsetLegacyPasswordOfMigratedUsers).mockRejectedValueOnce(
        new Error('db down'),
      );

      const res = await request(app).delete('/legacy-passwords');

      expect(res.status).toBe(500);
      expect(res.body.errors[0].code).toBe('legacy-password-delete-failed');
      expect(res.body.unsetCount).toBeUndefined();
      expect(activityEmit).not.toHaveBeenCalled();
    });
  });
});
