import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import type { Model } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import Activity from '~/server/models/activity';
import { UserStatus } from '~/server/models/user/conts';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

interface TestRequest extends Request {
  user?: unknown;
  crowi?: Crowi;
}

const passthroughMiddleware = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => next();

// Lets each test set req.user for the hoisted login-required mock below.
const currentUser = vi.hoisted<{ value: unknown }>(() => ({ value: null }));

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => passthroughMiddleware,
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default: () => (req: TestRequest, _res: Response, next: NextFunction) => {
    req.user = currentUser.value;
    next();
  },
}));

describe('GET /usernames', () => {
  let app: express.Application;
  let crowi: Crowi;
  let User: Model<{
    name: string;
    username: string;
    email: string;
    status?: number;
    admin?: boolean;
  }>;

  beforeAll(async () => {
    crowi = await getInstance();
    User = crowi.models.User;
  });

  beforeEach(async () => {
    app = express();
    app.use(express.json());

    app.use((_req, res: ApiV3Response, next) => {
      res.apiv3 = (data: unknown) => res.json(data);
      res.apiv3Err = (error: unknown, statusCode?: number) => {
        const status = statusCode ?? (Array.isArray(error) ? 400 : 500);
        return res.status(status).json({ error: String(error) });
      };
      next();
    });

    app.use((req: TestRequest, _res, next) => {
      req.crowi = crowi;
      next();
    });

    const usersModule = await import('./users');
    const factoryCandidate =
      'default' in usersModule ? usersModule.default : usersModule;
    if (typeof factoryCandidate !== 'function') {
      throw new Error('Module does not export a router factory function');
    }
    const usersRouter = factoryCandidate(crowi);
    app.use('/', usersRouter);
  });

  afterEach(async () => {
    currentUser.value = null;
    await Promise.all([User.deleteMany({}), Activity.deleteMany({})]);
  });

  it('returns active users matching the query by default', async () => {
    currentUser.value = await User.create({
      name: 'Requester',
      username: 'requester',
      email: 'requester@example.com',
    });
    await User.create({
      name: 'Alice',
      username: 'alice',
      email: 'alice@example.com',
      status: UserStatus.STATUS_ACTIVE,
    });

    const response = await request(app).get('/usernames').query({ q: 'ali' });

    expect(response.status).toBe(200);
    expect(response.body.activeUser.usernames).toContain('alice');
  });

  it('returns inactive users when isIncludeInactiveUser is requested', async () => {
    currentUser.value = await User.create({
      name: 'Requester',
      username: 'requester2',
      email: 'requester2@example.com',
    });
    await User.create({
      name: 'Bob',
      username: 'bob',
      email: 'bob@example.com',
      status: UserStatus.STATUS_SUSPENDED,
    });

    const response = await request(app)
      .get('/usernames')
      .query({
        q: 'bob',
        options: JSON.stringify({
          isIncludeActiveUser: false,
          isIncludeInactiveUser: true,
        }),
      });

    expect(response.status).toBe(200);
    expect(response.body.inactiveUser.usernames).toContain('bob');
  });

  it('returns activity snapshot usernames for admins', async () => {
    currentUser.value = await User.create({
      name: 'Admin',
      username: 'admin-user',
      email: 'admin@example.com',
      admin: true,
    });
    await Activity.create({
      action: SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL,
      snapshot: { username: 'ghost-user' },
    });

    const response = await request(app)
      .get('/usernames')
      .query({
        q: 'ghost',
        options: JSON.stringify({
          isIncludeActiveUser: false,
          isIncludeActivitySnapshotUser: true,
        }),
      });

    expect(response.status).toBe(200);
    expect(response.body.activitySnapshotUser).toEqual({
      usernames: ['ghost-user'],
      totalCount: 1,
    });
  });

  it('does not include activity snapshot usernames for non-admins even when requested', async () => {
    currentUser.value = await User.create({
      name: 'Regular',
      username: 'regular-user',
      email: 'regular@example.com',
      admin: false,
    });
    await Activity.create({
      action: SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL,
      snapshot: { username: 'ghost-user' },
    });

    const response = await request(app)
      .get('/usernames')
      .query({
        q: 'ghost',
        options: JSON.stringify({
          isIncludeActiveUser: false,
          isIncludeActivitySnapshotUser: true,
        }),
      });

    expect(response.status).toBe(200);
    expect(response.body.activitySnapshotUser).toBeUndefined();
  });
});
