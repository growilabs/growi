/**
 * Integration tests for PUT /_api/v3/inline-comments/:id/resolve (task 3.5).
 *
 * Same passthrough-auth pattern as create.integ.ts — see that file's header.
 *
 * Requirements: 4.1-4.5, 1.5, 1.6, 6.1
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

import { resolveInlineCommentRouteHandlersFactory } from './resolve';

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

const FIXTURE_ROOT = '/inline-comment-resolve-route-integ';
const requesterUsername = 'inline-comment-resolve-route-integ-requester';
const ownerUsername = 'inline-comment-resolve-route-integ-owner';

describe('PUT /_api/v3/inline-comments/:id/resolve', () => {
  let app: express.Application;
  let crowi: Crowi;
  let requester: HydratedDocument<IUserHasId>;
  let owner: HydratedDocument<IUserHasId>;
  let publicPage: HydratedDocument<PageDocument>;
  let forbiddenPage: HydratedDocument<PageDocument>;
  let originCommentId: string;
  let originCommentOnForbiddenPageId: string;
  let replyCommentId: string;

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

    const origin = await prisma.comments.create({
      data: {
        pageId: String(publicPage._id),
        creatorId: String(owner._id),
        comment: 'origin inline comment',
        isInline: true,
        quote: 'quoted text',
        prefix: '',
        suffix: '',
        approxOffset: 0,
        anchorOriginRevisionId: String(new Types.ObjectId()),
      },
    });
    originCommentId = origin.id;

    const originOnForbidden = await prisma.comments.create({
      data: {
        pageId: String(forbiddenPage._id),
        creatorId: String(owner._id),
        comment: 'origin inline comment on forbidden page',
        isInline: true,
        quote: 'quoted text',
        prefix: '',
        suffix: '',
        approxOffset: 0,
        anchorOriginRevisionId: String(new Types.ObjectId()),
      },
    });
    originCommentOnForbiddenPageId = originOnForbidden.id;

    const reply = await prisma.comments.create({
      data: {
        pageId: String(publicPage._id),
        creatorId: String(owner._id),
        comment: 'a reply, not an origin',
        isInline: true,
        replyToId: origin.id,
      },
    });
    replyCommentId = reply.id;

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
    // NOTE: app.use(prefix, handlers) does NOT parse an `:id` route param —
    // only a Router route registration (post/get/put) does. Mirror
    // production's mounting (apps/app/src/server/routes/apiv3/index.js)
    // exactly, or `req.params.id` is undefined and every request 400s on
    // express-validator's `param('id').isMongoId()`.
    const inlineCommentsRouter = express.Router();
    inlineCommentsRouter.put(
      '/:id/resolve',
      resolveInlineCommentRouteHandlersFactory(crowi),
    );
    app.use('/_api/v3/inline-comments', inlineCommentsRouter);
  }, 120_000);

  afterAll(async () => {
    const { Page } = crowi.models;
    await Page.deleteMany({
      _id: { $in: [publicPage._id, forbiddenPage._id] },
    });
    await crowi.models.User.deleteMany({
      username: { $in: [requesterUsername, ownerUsername] },
    });
    // Replies before origins — see create-reply.integ.ts's afterAll comment
    // for why (Prisma's Mongo connector rejects deleting a parent and its
    // referencing child in the same deleteMany() call).
    await prisma.comments.deleteMany({
      where: {
        pageId: { in: [String(publicPage._id), String(forbiddenPage._id)] },
        replyToId: { not: null },
      },
    });
    await prisma.comments.deleteMany({
      where: {
        pageId: { in: [String(publicPage._id), String(forbiddenPage._id)] },
      },
    });
  });

  it('resolves, then unresolves, an origin comment (200) and records/clears resolvedBy/resolvedAt', async () => {
    const resolveRes = await request(app)
      .put(`/_api/v3/inline-comments/${originCommentId}/resolve`)
      .send({ resolved: true });

    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.inlineComment.resolvedById).toBe(
      String(requester._id),
    );
    expect(resolveRes.body.inlineComment.resolvedAt).not.toBeNull();

    const unresolveRes = await request(app)
      .put(`/_api/v3/inline-comments/${originCommentId}/resolve`)
      .send({ resolved: false });

    expect(unresolveRes.status).toBe(200);
    expect(unresolveRes.body.inlineComment.resolvedById).toBeNull();
    expect(unresolveRes.body.inlineComment.resolvedAt).toBeNull();
  });

  it('returns 400 when :id is a reply (not an origin comment)', async () => {
    const res = await request(app)
      .put(`/_api/v3/inline-comments/${replyCommentId}/resolve`)
      .send({ resolved: true });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'inline-comment-not-origin' }),
    ]);
  });

  it('returns 404 when :id does not exist', async () => {
    const res = await request(app)
      .put(`/_api/v3/inline-comments/${new Types.ObjectId()}/resolve`)
      .send({ resolved: true });

    expect(res.status).toBe(404);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'inline-comment-not-found' }),
    ]);
  });

  it('returns 404 (uniform, not 403) when the requester lacks view permission on the page', async () => {
    const res = await request(app)
      .put(`/_api/v3/inline-comments/${originCommentOnForbiddenPageId}/resolve`)
      .send({ resolved: true });

    expect(res.status).toBe(404);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'notfound_or_forbidden' }),
    ]);
  });

  it('returns 400 when resolved is not a boolean', async () => {
    const res = await request(app)
      .put(`/_api/v3/inline-comments/${originCommentId}/resolve`)
      .send({ resolved: 'yes' });

    expect(res.status).toBe(400);
  });
});
