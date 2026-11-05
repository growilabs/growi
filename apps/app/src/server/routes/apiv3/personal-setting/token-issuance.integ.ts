import { faker } from '@faker-js/faker';
import { SCOPE, type Scope } from '@growi/core/dist/interfaces';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type UserEvent from '~/server/events/user';
import { AccessToken } from '~/server/models/access-token';

import type { ApiV3Response } from '../interfaces/apiv3-response';
import { setup } from './index';

vi.mock('~/server/middlewares/add-activity', () => ({
  generateAddActivityMiddleware:
    () => (_req: Request, res: Response, next: NextFunction) => {
      res.locals.activity = { _id: 'activity-id' };
      next();
    },
}));

const BASE_PATH = '/_api/v3/personal-setting';

describe('token issuance APIs accept only session authentication', () => {
  // biome-ignore lint/suspicious/noImplicitAnyLet: the User model factory is untyped JS
  let User;
  let router: express.Router;

  beforeAll(async () => {
    const crowiMock = mock<Crowi>({
      events: {
        user: mock<UserEvent>({ on: vi.fn() }),
        activity: { emit: vi.fn() },
      },
      configManager: { getConfig: vi.fn().mockReturnValue(8) },
    });
    const userModelFactory = (await import('../../../models/user')).default;
    User = userModelFactory(crowiMock);
    crowiMock.models = { User };

    // The router is a module-level singleton, so it is set up only once
    router = setup(crowiMock);
  });

  // Mirrors passport.session(): only a session sets req.user before the router
  const buildApp = (sessionUser?: unknown) => {
    const app = express();
    app.use(express.json());
    app.use((req: Request & { user?: unknown }, res, next) => {
      if (sessionUser != null) {
        req.user = sessionUser;
      }
      (res as ApiV3Response).apiv3 = (body: unknown, status = 200) =>
        res.status(status).json(body);
      // mirrors the 400 default of the real apiv3Err in routes/apiv3/response.js
      (res as ApiV3Response).apiv3Err = (errors: unknown, status = 400) =>
        res.status(status).json({ errors });
      next();
    });
    app.use(BASE_PATH, router);
    return app;
  };

  const createUser = async () => {
    const user = await User.create({
      name: faker.person.fullName(),
      username: faker.string.uuid(),
      password: faker.internet.password(),
      lang: 'en_US',
    });
    await user.updateApiToken();
    return user;
  };

  const issueToken = async (userId: string, scopes: Scope[]) => {
    const { token } = await AccessToken.generateToken(
      userId,
      new Date(Date.now() + 60 * 60 * 1000),
      scopes,
    );
    return token;
  };

  const countTokens = (userId: string) =>
    AccessToken.countDocuments({ user: userId });

  const newTokenBody = {
    expiredAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    scopes: [SCOPE.READ.FEATURES.PAGE],
  };

  describe('POST /access-token', () => {
    it.each([
      [
        'the access token issuance scope',
        [SCOPE.WRITE.USER_SETTINGS.API.ACCESS_TOKEN],
      ],
      ['the write wildcard', [SCOPE.WRITE.ALL]],
    ])('rejects an access token with %s', async (_, scopes) => {
      const user = await createUser();
      const token = await issueToken(user._id, scopes);
      const countBefore = await countTokens(user._id);

      const res = await request(buildApp())
        .post(`${BASE_PATH}/access-token`)
        .set('Authorization', `Bearer ${token}`)
        .send(newTokenBody);

      expect(res.status).toBe(403);
      expect(await countTokens(user._id)).toBe(countBefore);
    });

    it('issues a new token for a session user', async () => {
      const user = await createUser();
      const countBefore = await countTokens(user._id);

      const res = await request(buildApp(user))
        .post(`${BASE_PATH}/access-token`)
        .send(newTokenBody);

      expect(res.status).toBe(200);
      expect(res.body.token).toEqual(expect.any(String));
      expect(await countTokens(user._id)).toBe(countBefore + 1);
    });
  });

  describe('PUT /api-token', () => {
    it('rejects an access token with the api token scope', async () => {
      const user = await createUser();
      const token = await issueToken(user._id, [
        SCOPE.WRITE.USER_SETTINGS.API.API_TOKEN,
      ]);

      const res = await request(buildApp())
        .put(`${BASE_PATH}/api-token`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      const reloaded = await User.findById(user._id);
      expect(reloaded.apiToken).toBe(user.apiToken);
    });

    it('regenerates the api token for a session user', async () => {
      const user = await createUser();
      const apiTokenBefore = user.apiToken;

      const res = await request(buildApp(user)).put(`${BASE_PATH}/api-token`);

      expect(res.status).toBe(200);
      const reloaded = await User.findById(user._id);
      expect(reloaded.apiToken).toEqual(expect.any(String));
      expect(reloaded.apiToken).not.toBe(apiTokenBefore);
    });
  });

  it('still lists access tokens via an access token (GET /access-token)', async () => {
    const user = await createUser();
    const token = await issueToken(user._id, [
      SCOPE.READ.USER_SETTINGS.API.ACCESS_TOKEN,
    ]);

    const res = await request(buildApp())
      .get(`${BASE_PATH}/access-token`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});
