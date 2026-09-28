/**
 * Integration tests for DELETE /_api/v3/inline-comments/:id (task 2.3).
 *
 * Same passthrough-auth pattern as update.integ.ts — see that file's header.
 *
 * Requirements: 18.5, 18.6, 18.7, 18.8, 18.9
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

import { deleteInlineCommentRouteHandlersFactory } from './delete';

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

const FIXTURE_ROOT = '/inline-comment-delete-route-integ';
const creatorUsername = 'inline-comment-delete-route-integ-creator';
const otherUsername = 'inline-comment-delete-route-integ-other';
const readOnlyUsername = 'inline-comment-delete-route-integ-readonly';

describe('DELETE /_api/v3/inline-comments/:id', () => {
  let app: express.Application;
  let crowi: Crowi;
  let creator: HydratedDocument<IUserHasId>;
  let other: HydratedDocument<IUserHasId>;
  let readOnlyUser: HydratedDocument<IUserHasId>;
  let publicPage: HydratedDocument<PageDocument>;

  const mountAppAs = (requester: HydratedDocument<IUserHasId>) => {
    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);

    const mounted = express();
    mounted.use(express.json());
    mounted.use((_req, res, next) => {
      Object.assign(res, responseHelpers.response);
      next();
    });
    mounted.use((req: AuthenticatedRequest, _res, next) => {
      req.user = requester;
      next();
    });
    // NOTE: app.use(prefix, handlers) does NOT parse an `:id` route param —
    // only a Router route registration (delete/post/get/put) does. Mirror
    // production's mounting (apps/app/src/server/routes/apiv3/index.js)
    // exactly, or `req.params.id` is undefined and every request 400s on
    // express-validator's `param('id').isMongoId()`.
    const inlineCommentsRouter = express.Router();
    inlineCommentsRouter.delete(
      '/:id',
      deleteInlineCommentRouteHandlersFactory(crowi),
    );
    mounted.use('/_api/v3/inline-comments', inlineCommentsRouter);
    return mounted;
  };

  const createOriginWithReply = async () => {
    const origin = await prisma.comments.create({
      data: {
        pageId: String(publicPage._id),
        creatorId: String(creator._id),
        comment: 'origin inline comment',
        isInline: true,
        quote: 'quoted text',
        prefix: '',
        suffix: '',
        approxOffset: 0,
        anchorOriginRevisionId: String(new Types.ObjectId()),
      },
    });
    const reply = await prisma.comments.create({
      data: {
        pageId: String(publicPage._id),
        creatorId: String(creator._id),
        comment: 'a reply, not an origin',
        isInline: true,
        replyToId: origin.id,
      },
    });
    return { originId: origin.id, replyId: reply.id };
  };

  beforeAll(async () => {
    crowi = await getInstance();
    crowi.setupCommentService();
    const { Page } = crowi.models;
    const User = mongoose.model<IUserHasId>('User');

    await User.deleteMany({
      username: { $in: [creatorUsername, otherUsername, readOnlyUsername] },
    });
    creator = await User.create({
      name: creatorUsername,
      username: creatorUsername,
      email: `${creatorUsername}@example.com`,
    });
    other = await User.create({
      name: otherUsername,
      username: otherUsername,
      email: `${otherUsername}@example.com`,
    });
    // Read-only-user restriction (requirements.md Requirement 18, AC 18.8/
    // 18.9): `security:isRomUserAllowedToComment` defaults to false
    // (config-definition.ts), so this user is denied by
    // `excludeReadOnlyUserIfCommentNotAllowed` with no further config setup.
    readOnlyUser = await User.create({
      name: readOnlyUsername,
      username: readOnlyUsername,
      email: `${readOnlyUsername}@example.com`,
      readOnly: true,
    });

    publicPage = await Page.create({
      path: `${FIXTURE_ROOT}/public`,
      grant: PageGrant.GRANT_PUBLIC,
      creator: creator._id,
      lastUpdateUser: creator._id,
      // constructBasicPageInfo() dereferences page.revision! for non-empty
      // pages; this fixture only needs to pass the viewer-filtered
      // existence/permission check, so isEmpty:true takes the
      // no-revision-required branch.
      isEmpty: true,
    });

    app = mountAppAs(creator);
  }, 120_000);

  afterAll(async () => {
    const { Page } = crowi.models;
    await Page.deleteMany({ _id: publicPage._id });
    await crowi.models.User.deleteMany({
      username: { $in: [creatorUsername, otherUsername, readOnlyUsername] },
    });
    // Replies before origins — see create-reply.integ.ts's afterAll comment
    // for why (Prisma's Mongo connector rejects deleting a parent and its
    // referencing child in the same deleteMany() call).
    await prisma.comments.deleteMany({
      where: { pageId: String(publicPage._id), replyToId: { not: null } },
    });
    await prisma.comments.deleteMany({
      where: { pageId: String(publicPage._id) },
    });
  });

  it('returns 400 when a read-only user (not allowed to comment) attempts the delete', async () => {
    const { originId } = await createOriginWithReply();
    const readOnlyApp = mountAppAs(readOnlyUser);

    const res = await request(readOnlyApp).delete(
      `/_api/v3/inline-comments/${originId}`,
    );

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'validation_failed' }),
    ]);
  });

  it('returns 400 when :id is a reply (not an origin comment)', async () => {
    const { replyId } = await createOriginWithReply();

    const res = await request(app).delete(
      `/_api/v3/inline-comments/${replyId}`,
    );

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'inline-comment-not-origin' }),
    ]);
  });

  it('returns 403 when the requester is not the comment creator', async () => {
    const { originId } = await createOriginWithReply();
    const otherApp = mountAppAs(other);

    const res = await request(otherApp).delete(
      `/_api/v3/inline-comments/${originId}`,
    );

    expect(res.status).toBe(403);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'inline-comment-forbidden' }),
    ]);
  });

  it('returns 404 when :id does not exist', async () => {
    const res = await request(app).delete(
      `/_api/v3/inline-comments/${new Types.ObjectId()}`,
    );

    expect(res.status).toBe(404);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'inline-comment-not-found' }),
    ]);
  });

  it('deletes the origin comment and cascades to its replies (200)', async () => {
    const { originId, replyId } = await createOriginWithReply();

    const res = await request(app).delete(
      `/_api/v3/inline-comments/${originId}`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});

    // Cascade assertion: both the origin comment and its reply must be gone
    // from the database, not merely reported as a successful HTTP response
    // (requirement 18.6 — removeWithReplies cascades the delete).
    const originRow = await prisma.comments.findUnique({
      where: { id: originId },
    });
    const replyRow = await prisma.comments.findUnique({
      where: { id: replyId },
    });
    expect(originRow).toBeNull();
    expect(replyRow).toBeNull();
  });
});
