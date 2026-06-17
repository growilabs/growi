import { PageWriteGrant } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mockRequire from 'mock-require';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getInstance } from '^/test/setup/crowi';

import type { ApiV3Response } from '../interfaces/apiv3-response';

const passthroughMiddleware = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => next();

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => passthroughMiddleware,
}));
vi.mock('~/server/middlewares/login-required', () => ({
  default: () => (req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('~/server/middlewares/exclude-read-only-user', () => ({
  excludeReadOnlyUser: (_req: Request, _res: Response, next: NextFunction) =>
    next(),
}));

describe('PUT /page (update-page)', () => {
  let crowi: Awaited<ReturnType<typeof getInstance>>;
  let User: mongoose.Model<any>;
  let Page: mongoose.Model<any>;
  let Revision: mongoose.Model<any>;
  let user1: any;
  let user2: any;
  let testPage: any;
  let testRevision: any;
  let pageRouterFactory: any;

  const createApp = async (user: any) => {
    if (pageRouterFactory == null) {
      const pageModule = await import('./index');
      pageRouterFactory = (pageModule as any).default;
    }

    const app = express();
    app.use(express.json());

    app.use((_req: Request, res: ApiV3Response, next: NextFunction) => {
      res.apiv3 = (data: any) => res.json(data);
      res.apiv3Err = (error: any, statusCode?: number) => {
        const status = statusCode ?? (Array.isArray(error) ? 400 : 500);
        return res.status(status).json({ error: String(error) });
      };
      next();
    });

    app.use((req: any, _res: Response, next: NextFunction) => {
      req.user = user;
      req.crowi = crowi;
      next();
    });

    const pageRouter = pageRouterFactory(crowi);
    app.use('/', pageRouter);

    return app;
  };

  beforeAll(async () => {
    crowi = await getInstance();
    User = mongoose.model('User');
    Page = mongoose.model('Page');
    Revision = mongoose.model('Revision');

    user1 = await User.create({
      name: 'User1',
      username: 'user1',
      email: 'user1@example.com',
    });
    user2 = await User.create({
      name: 'User2',
      username: 'user2',
      email: 'user2@example.com',
    });

    const existingRootPage = await Page.findOne({ path: '/' });
    if (existingRootPage == null) {
      await Page.create({ path: '/', grant: 1 });
    }

    testPage = await Page.create({
      path: '/test-update-page',
      grant: 1,
      creator: user1._id,
      lastUpdateUser: user1._id,
    });

    testRevision = await Revision.create({
      pageId: testPage._id,
      body: 'initial body',
      author: user1._id,
    });

    testPage.revision = testRevision._id;
    await testPage.save();

    mockRequire(
      '../../../middlewares/certify-shared-page',
      () => passthroughMiddleware,
    );
  });

  afterAll(() => {
    mockRequire.stopAll();
  });

  it('should return 403 when user is in readOnlyUserIds', async () => {
    await Page.updateOne(
      { _id: testPage._id },
      { $set: { readOnlyUserIds: [user2._id] } },
    );

    const app = await createApp(user2);
    const response = await request(app)
      .put('/')
      .send({
        pageId: String(testPage._id),
        body: 'malicious update',
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('permission');
  });

  it('should return 403 when writeGrant is OWNER and user is not owner', async () => {
    await Page.updateOne(
      { _id: testPage._id },
      {
        $set: {
          readOnlyUserIds: [],
          writeGrant: PageWriteGrant.WRITE_GRANT_OWNER,
          writeGrantedUsers: [user1._id],
        },
      },
    );

    const app = await createApp(user2);
    const response = await request(app)
      .put('/')
      .send({
        pageId: String(testPage._id),
        body: 'malicious update',
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('permission');
  });
});
