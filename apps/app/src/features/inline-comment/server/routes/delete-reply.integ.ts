/**
 * Integration tests for DELETE /_api/v3/inline-comments/replies/:id
 * (task 2.4).
 *
 * Same passthrough-auth pattern as delete.integ.ts — see that file's header.
 *
 * Requirements: 18.5, 18.7, 18.8, 18.9
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

import { deleteInlineCommentReplyRouteHandlersFactory } from './delete-reply';

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

const FIXTURE_ROOT = '/inline-comment-delete-reply-route-integ';
const creatorUsername = 'inline-comment-delete-reply-route-integ-creator';
const otherUsername = 'inline-comment-delete-reply-route-integ-other';
const readOnlyUsername = 'inline-comment-delete-reply-route-integ-readonly';

describe('DELETE /_api/v3/inline-comments/replies/:id', () => {
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
      '/replies/:id',
      deleteInlineCommentReplyRouteHandlersFactory(crowi),
    );
    mounted.use('/_api/v3/inline-comments', inlineCommentsRouter);
    return mounted;
  };

  const createOriginWithReplies = async () => {
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
    const targetReply = await prisma.comments.create({
      data: {
        pageId: String(publicPage._id),
        creatorId: String(creator._id),
        comment: 'a reply, to be deleted',
        isInline: true,
        replyToId: origin.id,
      },
    });
    const siblingReply = await prisma.comments.create({
      data: {
        pageId: String(publicPage._id),
        creatorId: String(creator._id),
        comment: 'a sibling reply, must survive',
        isInline: true,
        replyToId: origin.id,
      },
    });
    return {
      originId: origin.id,
      targetReplyId: targetReply.id,
      siblingReplyId: siblingReply.id,
    };
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
    const { targetReplyId } = await createOriginWithReplies();
    const readOnlyApp = mountAppAs(readOnlyUser);

    const res = await request(readOnlyApp).delete(
      `/_api/v3/inline-comments/replies/${targetReplyId}`,
    );

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'validation_failed' }),
    ]);
  });

  it('returns 400 when :id belongs to an origin comment (not a reply)', async () => {
    const { originId } = await createOriginWithReplies();

    const res = await request(app).delete(
      `/_api/v3/inline-comments/replies/${originId}`,
    );

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'inline-comment-not-reply' }),
    ]);
  });

  it('returns 403 when the requester is not the reply creator', async () => {
    const { targetReplyId } = await createOriginWithReplies();
    const otherApp = mountAppAs(other);

    const res = await request(otherApp).delete(
      `/_api/v3/inline-comments/replies/${targetReplyId}`,
    );

    expect(res.status).toBe(403);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'inline-comment-forbidden' }),
    ]);
  });

  it('returns 404 when :id does not exist', async () => {
    const res = await request(app).delete(
      `/_api/v3/inline-comments/replies/${new Types.ObjectId()}`,
    );

    expect(res.status).toBe(404);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'inline-comment-not-found' }),
    ]);
  });

  it('deletes only the target reply, leaving the origin and sibling reply intact (200)', async () => {
    const { originId, targetReplyId, siblingReplyId } =
      await createOriginWithReplies();

    const res = await request(app).delete(
      `/_api/v3/inline-comments/replies/${targetReplyId}`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});

    // Surgical-delete assertion: only the target reply row is gone. The
    // origin comment and the sibling reply must both survive — deleting a
    // reply must not cascade (requirement 18.5).
    const targetReplyRow = await prisma.comments.findUnique({
      where: { id: targetReplyId },
    });
    const originRow = await prisma.comments.findUnique({
      where: { id: originId },
    });
    const siblingReplyRow = await prisma.comments.findUnique({
      where: { id: siblingReplyId },
    });
    expect(targetReplyRow).toBeNull();
    expect(originRow).not.toBeNull();
    expect(siblingReplyRow).not.toBeNull();
  });
});
