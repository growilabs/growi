import { type IUser, PageGrant } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';

type AuthenticatedRequest = Request & {
  user?: HydratedDocument<IUser>;
};

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

vi.mock('~/server/middlewares/admin-required', () => ({
  default: () => passthroughMiddleware,
}));

describe('PUT /rename', () => {
  const requesterUsername = 'rename-route-integ-requester';
  const ownerUsername = 'rename-route-integ-owner';
  const sourcePath = '/rename-route-integ/source';
  const sourceChildPath = `${sourcePath}/child`;
  const renamedPath = '/rename-route-integ/renamed';
  const renamedChildPath = `${renamedPath}/child`;
  const forbiddenPath = '/rename-route-integ/forbidden';

  let app: express.Application;
  let crowi: Crowi;
  let requester: HydratedDocument<IUser>;
  let owner: HydratedDocument<IUser>;
  let rootPage: HydratedDocument<PageDocument> | null = null;
  let rootPageWasCreated = false;

  beforeAll(async () => {
    crowi = await getInstance();
    const { Page, User } = crowi.models;

    await Page.deleteMany({
      path: {
        $in: [
          sourcePath,
          sourceChildPath,
          renamedPath,
          renamedChildPath,
          forbiddenPath,
        ],
      },
    });
    await User.deleteMany({
      username: { $in: [requesterUsername, ownerUsername] },
    });

    rootPage = await Page.findOne({ path: '/' });
    if (rootPage == null) {
      rootPage = await Page.create({
        path: '/',
        grant: PageGrant.GRANT_PUBLIC,
      });
      rootPageWasCreated = true;
    }

    requester = await User.create({
      name: requesterUsername,
      username: requesterUsername,
      email: `${requesterUsername}@example.com`,
    });
    owner = await User.create({
      name: ownerUsername,
      username: ownerUsername,
      email: `${ownerUsername}@example.com`,
    });

    addCustomFunctionToResponse(express);

    app = express();
    app.use(express.json());
    app.use((req: AuthenticatedRequest, _res, next) => {
      req.user = requester;
      next();
    });

    const { setup } = await import('./index');
    app.use('/', setup(crowi));
  }, 120_000);

  afterEach(async () => {
    await crowi.models.Page.deleteMany({
      path: {
        $in: [
          sourcePath,
          sourceChildPath,
          renamedPath,
          renamedChildPath,
          forbiddenPath,
        ],
      },
    });
  });

  afterAll(async () => {
    await crowi.models.Page.deleteMany({
      path: {
        $in: [
          sourcePath,
          sourceChildPath,
          renamedPath,
          renamedChildPath,
          forbiddenPath,
        ],
      },
    });
    await crowi.models.User.deleteMany({
      username: { $in: [requesterUsername, ownerUsername] },
    });
    if (rootPageWasCreated && rootPage != null) {
      await crowi.models.Page.deleteOne({ _id: rootPage._id });
    }
  });

  it('returns 404 when an authenticated user renames a missing page', async () => {
    const pageId = new Types.ObjectId();

    const response = await request(app).put('/rename').send({
      pageId: pageId.toString(),
      newPagePath: renamedPath,
    });

    expect(response.status).toBe(404);
    expect(response.status).not.toBe(500);
    expect(response.body.errors).toEqual([
      expect.objectContaining({
        code: 'notfound_or_forbidden',
        message: `Page '${pageId}' is not found or forbidden`,
      }),
    ]);
  });

  it('returns 403 and leaves a forbidden page unchanged', async () => {
    const page = await crowi.models.Page.create({
      path: forbiddenPath,
      grant: PageGrant.GRANT_OWNER,
      grantedUsers: [owner._id],
      creator: owner._id,
      lastUpdateUser: owner._id,
      isEmpty: true,
      descendantCount: 0,
    });

    const response = await request(app).put('/rename').send({
      pageId: page._id.toString(),
      newPagePath: renamedPath,
    });

    expect(response.status).toBe(403);
    expect(response.status).not.toBe(500);
    expect(response.body.errors).toEqual([
      expect.objectContaining({
        code: 'notfound_or_forbidden',
        message: `Page '${page._id}' is not found or forbidden`,
      }),
    ]);

    const unchangedPage = await crowi.models.Page.findById(page._id);
    expect(unchangedPage?.path).toBe(forbiddenPath);
  });

  it('renames an accessible page and its descendant', async () => {
    if (rootPage == null) {
      throw new Error('root page must be initialized in beforeAll');
    }

    const page = await crowi.models.Page.create({
      path: sourcePath,
      parent: rootPage._id,
      grant: PageGrant.GRANT_PUBLIC,
      creator: requester._id,
      lastUpdateUser: requester._id,
      isEmpty: true,
      descendantCount: 1,
    });
    const childPage = await crowi.models.Page.create({
      path: sourceChildPath,
      grant: PageGrant.GRANT_PUBLIC,
      creator: requester._id,
      lastUpdateUser: requester._id,
      descendantCount: 0,
    });

    const response = await request(app).put('/rename').send({
      pageId: page._id.toString(),
      newPagePath: renamedPath,
    });

    expect(response.status).toBe(200);
    expect(response.body.page.path).toBe(renamedPath);

    const renamedPage = await crowi.models.Page.findById(page._id);
    expect(renamedPage?.path).toBe(renamedPath);

    const renamedChildPage = await crowi.models.Page.findById(childPage._id);
    expect(renamedChildPage?.path).toBe(renamedChildPath);
  });
});
