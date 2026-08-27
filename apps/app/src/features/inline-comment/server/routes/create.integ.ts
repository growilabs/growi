/**
 * Integration tests for POST /_api/v3/inline-comments (task 3.5).
 *
 * `accessTokenParser`/`loginRequired` are mocked to a passthrough that injects
 * `req.user` (the codebase's established pattern — see
 * `apps/app/src/server/routes/apiv3/page/export.integ.ts`); everything else
 * (express-validator chain, `apiV3FormValidator`, `findPageAndMetaDataByViewer`,
 * `InlineCommentService`, and the real `comments`/`pages` collections) runs for
 * real against the app-integration MongoDB.
 *
 * Requirements: 1.1-1.7, 1.5, 1.6, 6.1
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
import { prisma } from '~/utils/prisma';

import { createInlineCommentRouteHandlersFactory } from './create';

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

const FIXTURE_ROOT = '/inline-comment-create-route-integ';
const requesterUsername = 'inline-comment-create-route-integ-requester';
const ownerUsername = 'inline-comment-create-route-integ-owner';

describe('POST /_api/v3/inline-comments', () => {
  let app: express.Application;
  let crowi: Crowi;
  let requester: HydratedDocument<IUserHasId>;
  let owner: HydratedDocument<IUserHasId>;
  let publicPage: HydratedDocument<PageDocument>;
  let forbiddenPage: HydratedDocument<PageDocument>;

  beforeAll(async () => {
    crowi = await getInstance();
    crowi.setupCommentService();
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

    publicPage = await Page.create({
      path: `${FIXTURE_ROOT}/public`,
      grant: PageGrant.GRANT_PUBLIC,
      creator: owner._id,
      lastUpdateUser: owner._id,
      // constructBasicPageInfo() dereferences page.revision! for non-empty
      // pages; this fixture only needs to pass the viewer-filtered
      // existence/permission check, so isEmpty:true takes the
      // no-revision-required branch.
      isEmpty: true,
    });
    forbiddenPage = await Page.create({
      path: `${FIXTURE_ROOT}/forbidden`,
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
    app.use(
      '/_api/v3/inline-comments',
      createInlineCommentRouteHandlersFactory(crowi),
    );
  }, 120_000);

  afterAll(async () => {
    const { Page } = crowi.models;
    await Page.deleteMany({
      _id: { $in: [publicPage._id, forbiddenPage._id] },
    });
    await crowi.models.User.deleteMany({
      username: { $in: [requesterUsername, ownerUsername] },
    });
  });

  const validBody = () => ({
    pageId: String(publicPage._id),
    anchorOriginRevisionId: String(new Types.ObjectId()),
    comment: 'inline comment body',
    anchor: {
      quote: 'quoted text',
      prefix: 'before ',
      suffix: ' after',
      approxOffset: 10,
    },
  });

  it('creates an origin inline comment (201) and persists the anchor verbatim', async () => {
    const res = await request(app)
      .post('/_api/v3/inline-comments')
      .send(validBody());

    expect(res.status).toBe(201);
    expect(res.body.inlineComment).toMatchObject({
      pageId: String(publicPage._id),
      comment: 'inline comment body',
      anchor: {
        quote: 'quoted text',
        prefix: 'before ',
        suffix: ' after',
        approxOffset: 10,
      },
    });

    const row = await prisma.comments.findUnique({
      where: { id: res.body.inlineComment.id },
    });
    expect(row?.isInline).toBe(true);
  });

  it('returns 400 when anchor.quote is empty (service precondition)', async () => {
    const res = await request(app)
      .post('/_api/v3/inline-comments')
      .send({ ...validBody(), anchor: { ...validBody().anchor, quote: '' } });

    expect(res.status).toBe(400);
  });

  it('returns 400 when pageId is not a valid MongoId (express-validator)', async () => {
    const res = await request(app)
      .post('/_api/v3/inline-comments')
      .send({ ...validBody(), pageId: 'not-an-id' });

    expect(res.status).toBe(400);
  });

  it('returns 404 for a nonexistent pageId', async () => {
    const res = await request(app)
      .post('/_api/v3/inline-comments')
      .send({ ...validBody(), pageId: String(new Types.ObjectId()) });

    expect(res.status).toBe(404);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'notfound_or_forbidden' }),
    ]);
  });

  it('returns 404 (uniform, not 403) when the requester lacks view permission on the page', async () => {
    // See apps/app/.claude/rules/page-write-action-403-404.md — an
    // authenticated-but-unauthorized caller must not be able to distinguish
    // "does not exist" from "exists but I cannot see it".
    const res = await request(app)
      .post('/_api/v3/inline-comments')
      .send({ ...validBody(), pageId: String(forbiddenPage._id) });

    expect(res.status).toBe(404);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'notfound_or_forbidden' }),
    ]);
  });
});
