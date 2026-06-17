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

describe('PUT /:pageId/read-only-users', () => {
  let crowi: Awaited<ReturnType<typeof getInstance>>;
  let User: mongoose.Model<any>;
  let Page: mongoose.Model<any>;
  let user1: any;
  let user2: any;
  let testPage: any;
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

    const GRANT_PUBLIC = 1;

    const existingRootPage = await Page.findOne({ path: '/' });
    if (existingRootPage == null) {
      await Page.create({ path: '/', grant: GRANT_PUBLIC });
    }

    testPage = await Page.create({
      path: '/test-read-only-page',
      grant: GRANT_PUBLIC,
      creator: user1._id,
      lastUpdateUser: user1._id,
    });

    mockRequire(
      '../../../middlewares/certify-shared-page',
      () => passthroughMiddleware,
    );
  });

  afterAll(() => {
    mockRequire.stopAll();
  });

  it('should set readOnlyUserIds for a page', async () => {
    const app = await createApp(user1);
    await Page.updateOne(
      { _id: testPage._id },
      { $set: { readOnlyUserIds: [] } },
    );

    const response = await request(app)
      .put(`/${testPage._id}/read-only-users`)
      .send({ readOnlyUserIds: [String(user2._id)] });

    expect(response.status).toBe(200);

    const updatedPage = await Page.findById(testPage._id);
    const userIds = (updatedPage.readOnlyUserIds ?? []).map((id: any) =>
      String(id),
    );
    expect(userIds).toContain(String(user2._id));
  });

  it('should clear readOnlyUserIds when empty array is sent', async () => {
    const app = await createApp(user1);
    await Page.updateOne(
      { _id: testPage._id },
      { $set: { readOnlyUserIds: [user2._id] } },
    );

    const response = await request(app)
      .put(`/${testPage._id}/read-only-users`)
      .send({ readOnlyUserIds: [] });

    expect(response.status).toBe(200);

    const updatedPage = await Page.findById(testPage._id);
    expect(updatedPage.readOnlyUserIds).toEqual([]);
  });

  it('should set multiple readOnly users', async () => {
    const app = await createApp(user1);
    const response = await request(app)
      .put(`/${testPage._id}/read-only-users`)
      .send({ readOnlyUserIds: [String(user1._id), String(user2._id)] });

    expect(response.status).toBe(200);

    const updatedPage = await Page.findById(testPage._id);
    expect(updatedPage.readOnlyUserIds).toHaveLength(2);
  });

  it('should return 400 for non-existent pageId', async () => {
    const app = await createApp(user1);
    const fakeId = new mongoose.Types.ObjectId();
    const response = await request(app)
      .put(`/${fakeId}/read-only-users`)
      .send({ readOnlyUserIds: [] });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('unreachable');
  });

  it('should return 403 when the user cannot edit the page', async () => {
    await Page.updateOne(
      { _id: testPage._id },
      {
        $set: {
          writeGrant: PageWriteGrant.WRITE_GRANT_OWNER,
          writeGrantedUsers: [user2._id],
        },
      },
    );

    const app = await createApp(user1);
    const response = await request(app)
      .put(`/${testPage._id}/read-only-users`)
      .send({ readOnlyUserIds: [] });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('permission');
  });
});
