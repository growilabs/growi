import type { Scope } from '@growi/core/dist/interfaces';
import { SCOPE } from '@growi/core/dist/interfaces';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { mockDeep } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import { AccessToken } from '~/server/models/access-token';

import type { ApiV3Response } from '../interfaces/apiv3-response';
import { generateAccessTokenHandlerFactory } from './generate-access-token';

type TestUser = { _id: string; admin: boolean };

const adminUser: TestUser = { _id: '6561a1a1a1a1a1a1a1a1a1a1', admin: true };
const nonAdminUser: TestUser = {
  _id: '6561b2b2b2b2b2b2b2b2b2b2',
  admin: false,
};

vi.mock('~/server/middlewares/login-required', () => ({
  default: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('~/server/middlewares/add-activity', () => ({
  generateAddActivityMiddleware:
    () => (_req: Request, res: Response, next: NextFunction) => {
      res.locals.activity = { _id: 'activity-id' };
      next();
    },
}));

vi.mock('~/server/models/access-token', () => ({
  AccessToken: { generateToken: vi.fn() },
}));

const buildApp = (user: TestUser) => {
  const app = express();
  app.use(express.json());
  app.use((req: Request & { user?: TestUser }, res, next) => {
    req.user = user;
    (res as ApiV3Response).apiv3 = (body: unknown, status = 200) =>
      res.status(status).json(body);
    // mirrors the 400 default of the real apiv3Err in routes/apiv3/response.js
    (res as ApiV3Response).apiv3Err = (errors: unknown, status = 400) =>
      res.status(status).json({ errors });
    next();
  });
  app.post(
    '/generate-access-token',
    generateAccessTokenHandlerFactory(mockDeep<Crowi>()),
  );
  return app;
};

const postScopes = (user: TestUser, scopes: Scope[]) =>
  request(buildApp(user))
    .post('/generate-access-token')
    .send({ expiredAt: '2099-12-31T00:00:00Z', scopes });

describe('POST /personal-setting/generate-access-token', () => {
  const generateToken = vi.mocked(AccessToken.generateToken);

  beforeEach(() => {
    vi.clearAllMocks();
    generateToken.mockResolvedValue({
      token: 'generated-token',
      _id: new Types.ObjectId(),
      expiredAt: new Date('2099-12-31T00:00:00Z'),
      scopes: [],
    });
  });

  it.each([
    ['a specific admin scope', [SCOPE.WRITE.ADMIN.AUDIT_LOG]],
    ['the admin wildcard', [SCOPE.READ.ADMIN.ALL]],
    ['the write wildcard', [SCOPE.WRITE.ALL]],
  ])('rejects %s requested by a non-admin user', async (_, scopes) => {
    const res = await postScopes(nonAdminUser, scopes);

    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
    expect(generateToken).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown wildcard scope', ['read:foo:bar:*']],
    ['a non-array scopes value', 'write:admin:*'],
  ])('responds to %s with validator messages only, not internal errors', async (_, scopes) => {
    const res = await postScopes(nonAdminUser, scopes as Scope[]);

    expect(res.status).toBe(400);
    const messages = res.body.errors.map(
      (err: { message: string }) => err.message,
    );
    expect(
      messages.every((message: string) =>
        ['scopes: scope must be an array', 'scopes: Invalid scope'].includes(
          message,
        ),
      ),
    ).toBe(true);
    expect(generateToken).not.toHaveBeenCalled();
  });

  it('issues a token with user scopes to a non-admin user', async () => {
    const res = await postScopes(nonAdminUser, [SCOPE.READ.FEATURES.PAGE]);

    expect(res.status).toBe(200);
    expect(res.body.token).toBe('generated-token');
  });

  it('issues a token with admin scopes to an admin user', async () => {
    const res = await postScopes(adminUser, [SCOPE.WRITE.ADMIN.AUDIT_LOG]);

    expect(res.status).toBe(200);
    expect(res.body.token).toBe('generated-token');
  });
});
