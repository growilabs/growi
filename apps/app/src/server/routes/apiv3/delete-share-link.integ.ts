/**
 * Integration test — DELETE /share-links/:id must deny a non-admin caller
 * uniformly (404) whether the related page no longer exists or the caller
 * simply cannot read it. The two must be indistinguishable to the caller
 * (see apps/app/.claude/rules/page-write-action-403-404.md).
 *
 * Before the fix, the route only blocked the "forbidden" case (an explicit
 * `Page.count` probe decided that): when the related page had already been
 * deleted, the permission check was skipped entirely and any logged-in
 * non-admin could delete the share link — a stronger oracle than a 403/404
 * split, since it flips the whole outcome (200 success vs 404 error) on
 * whether the page exists.
 */

import { type IUserHasId, PageGrant } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mongoose, { type HydratedDocument } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
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

const FIXTURE_ROOT = '/delete-share-link-route-integ';
const forbiddenPath = `${FIXTURE_ROOT}/forbidden`;

const requesterUsername = 'delete-share-link-route-integ-requester';
const ownerUsername = 'delete-share-link-route-integ-owner';

describe('DELETE /share-links/:id', () => {
  let app: express.Application;
  let crowi: Crowi;
  let requester: HydratedDocument<IUserHasId>;
  let owner: HydratedDocument<IUserHasId>;
  let forbiddenPage: HydratedDocument<PageDocument>;

  const buildApp = (user: HydratedDocument<IUserHasId>) => {
    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);

    const testApp = express();
    testApp.use(express.json());
    testApp.use((_req, res, next) => {
      Object.assign(res, responseHelpers.response);
      next();
    });
    testApp.use((req: AuthenticatedRequest, _res, next) => {
      req.user = user;
      next();
    });
    return testApp;
  };

  beforeAll(async () => {
    crowi = await getInstance();
    const { Page } = crowi.models;
    const User = mongoose.model<IUserHasId>('User');

    await User.deleteMany({
      username: { $in: [requesterUsername, ownerUsername] },
    });

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

    forbiddenPage = await Page.create({
      path: forbiddenPath,
      grant: PageGrant.GRANT_OWNER,
      grantedUsers: [owner._id],
      creator: owner._id,
      lastUpdateUser: owner._id,
    });

    const { setup } = await import('./share-links');
    app = buildApp(requester);
    app.use('/', setup(crowi));
  }, 120_000);

  afterAll(async () => {
    const { Page } = crowi.models;
    await Page.deleteOne({ _id: forbiddenPage._id });
    await crowi.models.User.deleteMany({
      username: { $in: [requesterUsername, ownerUsername] },
    });
  });

  it('returns 404 (same status as the other cases) when the share-link id itself does not exist', async () => {
    // Before the fix, a nonexistent share-link id crashed inside the try
    // block (dereferencing null) and answered a default 400 — a status
    // distinguishable from the 404 the other two cases return, letting a
    // non-admin caller learn "this share-link id exists" from the status
    // alone. See apps/app/.claude/rules/page-write-action-403-404.md.
    const bogusId = new mongoose.Types.ObjectId();

    const response = await request(app).delete(`/${bogusId}`);

    expect(response.status).toBe(404);
  });

  it('returns 404 and does not delete the share link when the related page no longer exists', async () => {
    const shareLink = await prisma.sharelinks.create({
      data: {
        relatedPageId: new mongoose.Types.ObjectId().toString(),
      },
    });

    const response = await request(app).delete(`/${shareLink._id}`);

    expect(response.status).toBe(404);
    const stillExists = await prisma.sharelinks.findUnique({
      where: { id: shareLink._id },
    });
    expect(stillExists).not.toBeNull();

    await prisma.sharelinks.delete({ where: { id: shareLink._id } });
  });

  it('returns 404 (same status) and does not delete the share link when the requester may not read the related page', async () => {
    const shareLink = await prisma.sharelinks.create({
      data: {
        relatedPageId: forbiddenPage._id.toString(),
      },
    });

    const response = await request(app).delete(`/${shareLink._id}`);

    expect(response.status).toBe(404);
    const stillExists = await prisma.sharelinks.findUnique({
      where: { id: shareLink._id },
    });
    expect(stillExists).not.toBeNull();

    await prisma.sharelinks.delete({ where: { id: shareLink._id } });
  });

  it('deletes the share link when an admin makes the request, even if the related page no longer exists', async () => {
    // The route's admin bypass reads `user.isAdmin` off req.user — but
    // `IUserHasId`/the User schema have no such field (the real field is
    // `admin`, e.g. server/models/user/index.js). So `user.isAdmin` is always
    // undefined for a real user, and this branch is unreachable in
    // production today; that mismatch is a separate, pre-existing bug and
    // out of scope here. This test exercises the branch as the code is
    // literally written, via a fresh object (never mutating the shared
    // `requester` fixture the other cases use).
    const adminUser = {
      ...requester.toObject(),
      isAdmin: true,
      // biome-ignore lint/suspicious/noExplicitAny: `isAdmin` isn't a real field on IUserHasId — see comment above
    } as any as HydratedDocument<IUserHasId>;

    const { setup } = await import('./share-links');
    const adminApp = buildApp(adminUser);
    adminApp.use('/', setup(crowi));

    const shareLink = await prisma.sharelinks.create({
      data: {
        relatedPageId: new mongoose.Types.ObjectId().toString(),
      },
    });

    const response = await request(adminApp).delete(`/${shareLink._id}`);

    expect(response.status).toBe(200);
    const stillExists = await prisma.sharelinks.findUnique({
      where: { id: shareLink._id },
    });
    expect(stillExists).toBeNull();
  });
});
