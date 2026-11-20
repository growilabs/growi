/**
 * Integration test — GET /page/export/:pageId must answer 404 for both "no
 * such page" and "the page exists but the requester may not read it": the
 * two must be indistinguishable to the caller (see
 * apps/app/.claude/rules/page-write-action-403-404.md). The route used to
 * split them into 403 (forbidden) vs 404 (not found) via an explicit
 * existence probe.
 *
 * Only the not-found/forbidden branch is exercised here — a full export
 * (markdown/pdf generation) is unrelated to this rule and not covered by
 * this suite.
 */

import { type IUserHasId, PageGrant } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';

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

const FIXTURE_ROOT = '/page-export-route-integ';
const forbiddenPath = `${FIXTURE_ROOT}/forbidden`;

const requesterUsername = 'page-export-route-integ-requester';
const ownerUsername = 'page-export-route-integ-owner';

describe('GET /page/export/:pageId', () => {
  let app: express.Application;
  let crowi: Crowi;
  let requester: HydratedDocument<IUserHasId>;
  let owner: HydratedDocument<IUserHasId>;
  let forbiddenPage: HydratedDocument<PageDocument>;

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

    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);

    app = express();
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
  }, 120_000);

  afterAll(async () => {
    const { Page } = crowi.models;
    await Page.deleteOne({ _id: forbiddenPage._id });
    await crowi.models.User.deleteMany({
      username: { $in: [requesterUsername, ownerUsername] },
    });
  });

  it('returns 404 when the page does not exist', async () => {
    const pageId = new Types.ObjectId();

    const response = await request(app).get(`/export/${pageId}?format=md`);

    expect(response.status).toBe(404);
    expect(response.body.errors).toEqual([
      expect.objectContaining({
        code: 'notfound_or_forbidden',
        message: `Page '${pageId}' is not found or forbidden`,
      }),
    ]);
  });

  it('returns 404 (not 403) when the page exists but the requester may not read it', async () => {
    const response = await request(app).get(
      `/export/${forbiddenPage._id}?format=md`,
    );

    // Same status as the "page does not exist" case above — a requester
    // without read access must not be able to tell a forbidden page apart
    // from a missing one. See apps/app/.claude/rules/page-write-action-403-404.md.
    expect(response.status).toBe(404);
    expect(response.body.errors).toEqual([
      expect.objectContaining({
        code: 'notfound_or_forbidden',
        message: `Page '${forbiddenPage._id}' is not found or forbidden`,
      }),
    ]);
  });
});
