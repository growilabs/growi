/**
 * Integration test — DELETE /empty-trash must leave trashed pages the requester is
 * not allowed to delete completely.
 *
 * The fixture and cleanup conventions follow delete-pages.integ.ts: the response
 * helpers are installed per request on this suite's own app, and everything written
 * lives under one path prefix.
 */

import { type IUserHasId, PageGrant } from '@growi/core';
import { escapeStringForMongoRegex } from '@growi/core/dist/utils';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import { PageDeleteConfigValue } from '~/interfaces/page-delete-config';
import type Crowi from '~/server/crowi';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { prisma } from '~/utils/prisma';

type AuthenticatedRequest = Request & {
  user?: HydratedDocument<IUserHasId>;
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

const FIXTURE_ROOT = '/trash/empty-trash-route-integ';
const trashedPath = `${FIXTURE_ROOT}/target`;

const requesterUsername = 'empty-trash-route-integ-requester';

// Sentinel ip (reached via X-Forwarded-For) so cleanup removes only the activity rows
// this suite created. Keep it distinct from the sentinels sibling suites use.
const TEST_IP = '10.0.0.116';

const fixturePathPattern = new RegExp(
  `^${escapeStringForMongoRegex(FIXTURE_ROOT)}(/|$)`,
);

describe('DELETE /empty-trash', () => {
  let app: express.Application;
  let crowi: Crowi;
  let requester: HydratedDocument<IUserHasId>;

  const removeFixtures = async (): Promise<void> => {
    await crowi.models.Page.deleteMany({ path: fixturePathPattern });
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  };

  beforeAll(async () => {
    crowi = await getInstance();
    const User = mongoose.model<IUserHasId>('User');

    await User.deleteMany({ username: requesterUsername });
    requester = await User.create({
      name: requesterUsername,
      username: requesterUsername,
      email: `${requesterUsername}@example.com`,
    });

    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);

    app = express();
    app.set('trust proxy', true);
    app.use(express.json());
    app.use((_req, res, next) => {
      Object.assign(res, responseHelpers.response);
      next();
    });
    app.use((req: AuthenticatedRequest, _res, next) => {
      req.user = requester;
      next();
    });

    const { setup } = await import('./index');
    app.use('/', setup(crowi));

    await removeFixtures();
  }, 120_000);

  afterEach(async () => {
    await removeFixtures();
    await crowi.configManager.updateConfig(
      'security:pageCompleteDeletionAuthority',
      undefined,
      { removeIfUndefined: true },
    );
  });

  afterAll(async () => {
    await crowi.models.User.deleteMany({ username: requesterUsername });
  });

  it('keeps a trashed page the requester is not allowed to delete completely', async () => {
    const { Page } = crowi.models;
    const trashedPage = await Page.create({
      path: trashedPath,
      grant: PageGrant.GRANT_PUBLIC,
      status: 'deleted',
      creator: requester._id,
      lastUpdateUser: requester._id,
      parent: null,
    });
    // The requester authored the page but is not an admin, so AdminOnly
    // forbids the complete deletion.
    await crowi.configManager.updateConfig(
      'security:pageCompleteDeletionAuthority',
      PageDeleteConfigValue.AdminOnly,
    );

    await request(app).delete('/empty-trash').set('X-Forwarded-For', TEST_IP);

    // The response itself is not asserted: it depends on whatever else other
    // suites left in the shared trash.
    const survivingPage = await Page.findById(trashedPage._id);
    expect(survivingPage?.path).toBe(trashedPath);
  });

  it('deletes only the trashed pages the requester is allowed to delete completely', async () => {
    const { Page } = crowi.models;
    const [ownPage, othersPage] = await Page.create([
      {
        path: `${FIXTURE_ROOT}/own`,
        grant: PageGrant.GRANT_PUBLIC,
        status: 'deleted',
        creator: requester._id,
        lastUpdateUser: requester._id,
        parent: null,
      },
      {
        path: `${FIXTURE_ROOT}/others`,
        grant: PageGrant.GRANT_PUBLIC,
        status: 'deleted',
        creator: new Types.ObjectId(),
        lastUpdateUser: new Types.ObjectId(),
        parent: null,
      },
    ]);
    await crowi.configManager.updateConfig(
      'security:pageCompleteDeletionAuthority',
      PageDeleteConfigValue.AdminAndAuthor,
    );

    const response = await request(app)
      .delete('/empty-trash')
      .set('X-Forwarded-For', TEST_IP);

    expect(response.status).toBe(200);
    expect(await Page.findById(ownPage._id)).toBeNull();
    expect((await Page.findById(othersPage._id))?.path).toBe(othersPage.path);
  });
});
