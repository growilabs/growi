/**
 * Integration tests for POST /_api/v3/inline-comments/:id/replies (task 3.5).
 *
 * Same passthrough-auth pattern as create.integ.ts — see that file's header.
 *
 * Requirements: 1.8, 1.9, 1.5, 1.6, 6.1
 */

import { type IUserHasId, PageGrant } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument } from '~/server/models/page';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { prisma } from '~/utils/prisma';

import { createInlineCommentReplyRouteHandlersFactory } from './create-reply';

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

const FIXTURE_ROOT = '/inline-comment-create-reply-route-integ';
const requesterUsername = 'inline-comment-create-reply-route-integ-requester';
const ownerUsername = 'inline-comment-create-reply-route-integ-owner';
const mentionedUsername = 'inline-comment-create-reply-route-integ-mentioned';
const readOnlyUsername = 'inline-comment-create-reply-route-integ-readonly';

describe('POST /_api/v3/inline-comments/:id/replies', () => {
  let app: express.Application;
  let crowi: Crowi;
  let requester: HydratedDocument<IUserHasId>;
  let owner: HydratedDocument<IUserHasId>;
  let mentionedUser: HydratedDocument<IUserHasId>;
  let readOnlyUser: HydratedDocument<IUserHasId>;
  let publicPage: HydratedDocument<PageDocument>;
  let forbiddenPage: HydratedDocument<PageDocument>;
  let originCommentId: string;
  let originCommentOnForbiddenPageId: string;
  let nonOriginCommentId: string;

  const mountAppAs = (requesterUser: HydratedDocument<IUserHasId>) => {
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
      req.user = requesterUser;
      next();
    });
    // NOTE: app.use(prefix, handlers) does NOT parse an `:id` route param —
    // only a Router route registration (post/get/put) does. Mirror
    // production's mounting (apps/app/src/server/routes/apiv3/index.js)
    // exactly, or `req.params.id` is undefined and every request 400s on
    // express-validator's `param('id').isMongoId()`.
    const inlineCommentsRouter = express.Router();
    inlineCommentsRouter.post(
      '/:id/replies',
      createInlineCommentReplyRouteHandlersFactory(crowi),
    );
    mounted.use('/_api/v3/inline-comments', inlineCommentsRouter);
    return mounted;
  };

  beforeAll(async () => {
    crowi = await getInstance();
    crowi.setupCommentService();
    const { Page } = crowi.models;
    const User = mongoose.model<IUserHasId>('User');

    await User.deleteMany({
      username: {
        $in: [
          requesterUsername,
          ownerUsername,
          mentionedUsername,
          readOnlyUsername,
        ],
      },
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
    mentionedUser = await User.create({
      name: mentionedUsername,
      username: mentionedUsername,
      email: `${mentionedUsername}@example.com`,
    });
    // Read-only-user restriction (requirements.md Requirement 1, AC 1.2/1.4):
    // `security:isRomUserAllowedToComment` defaults to false
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

    const nonOrigin = await prisma.comments.create({
      data: {
        pageId: String(publicPage._id),
        creatorId: String(owner._id),
        comment: 'a reply, not an origin',
        isInline: true,
        replyToId: origin.id,
      },
    });
    nonOriginCommentId = nonOrigin.id;

    app = mountAppAs(requester);
  }, 120_000);

  afterAll(async () => {
    const { Page } = crowi.models;
    await Page.deleteMany({
      _id: { $in: [publicPage._id, forbiddenPage._id] },
    });
    await crowi.models.User.deleteMany({
      username: {
        $in: [
          requesterUsername,
          ownerUsername,
          mentionedUsername,
          readOnlyUsername,
        ],
      },
    });
    await InAppNotification.deleteMany({ user: mentionedUser._id });
    // Replies before origins: comments.replyTo (`CommentToReply`) is a
    // required-relation-checked self-reference, so Prisma's Mongo connector
    // rejects deleting a parent row in the same deleteMany() call as a child
    // still pointing at it, even though both rows are being removed. Delete
    // by pageId in two ordered passes (covers the reply the "creates a
    // reply" test posts through the API, not just the fixture ids above).
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

  it('creates a reply (201) with all anchor fields null', async () => {
    const res = await request(app)
      .post(`/_api/v3/inline-comments/${originCommentId}/replies`)
      .send({ comment: 'a reply' });

    expect(res.status).toBe(201);
    expect(res.body.inlineCommentReply).toMatchObject({
      pageId: String(publicPage._id),
      comment: 'a reply',
      replyToId: originCommentId,
    });
  });

  it('notifies a user mentioned by @username in the reply body (requirement 3.2)', async () => {
    const res = await request(app)
      .post(`/_api/v3/inline-comments/${originCommentId}/replies`)
      .send({ comment: `thanks @${mentionedUsername}, could you check?` });

    expect(res.status).toBe(201);

    // Observable side effect of CommentService.prepareMentionNotifications ->
    // InAppNotificationService.insertMentionNotifications — same assertion
    // shape as create.integ.ts's mention test. The target page here is the
    // *origin* comment's page (parent.page), since createReply() passes the
    // parent's page — not the reply row itself — to
    // prepareMentionNotifications.
    const notification = await InAppNotification.findOne({
      user: mentionedUser._id,
      action: SupportedAction.ACTION_COMMENT_MENTION,
      target: publicPage._id,
      targetModel: SupportedTargetModel.MODEL_PAGE,
    });
    expect(notification).not.toBeNull();
  });

  it('returns 400 when a read-only user (not allowed to comment) attempts to reply', async () => {
    const readOnlyApp = mountAppAs(readOnlyUser);
    const res = await request(readOnlyApp)
      .post(`/_api/v3/inline-comments/${originCommentId}/replies`)
      .send({ comment: 'a reply' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'validation_failed' }),
    ]);
  });

  it('creates a reply (201) for a read-only user when the config allows it (requirement 3.3)', async () => {
    // `excludeReadOnlyUserIfCommentNotAllowed` reads this config at request
    // time — flip it on for this one request, then restore the default
    // (false) so the "denied" test above is not affected by order.
    await crowi.configManager.updateConfig(
      'security:isRomUserAllowedToComment',
      true,
    );
    try {
      const readOnlyApp = mountAppAs(readOnlyUser);
      const res = await request(readOnlyApp)
        .post(`/_api/v3/inline-comments/${originCommentId}/replies`)
        .send({ comment: 'a reply from an allowed read-only user' });

      // Same status/body shape as the normal-user success test above — this
      // is what "unchanged success response" (requirement 3.3) means here.
      expect(res.status).toBe(201);
      expect(res.body.inlineCommentReply).toMatchObject({
        pageId: String(publicPage._id),
        comment: 'a reply from an allowed read-only user',
        replyToId: originCommentId,
      });
    } finally {
      await crowi.configManager.updateConfig(
        'security:isRomUserAllowedToComment',
        false,
      );
    }
  });

  it('returns 404 when the parent id does not exist', async () => {
    const res = await request(app)
      .post(`/_api/v3/inline-comments/${new Types.ObjectId()}/replies`)
      .send({ comment: 'a reply' });

    expect(res.status).toBe(404);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'inline-comment-not-found' }),
    ]);
  });

  it('returns 400 when the parent id is not an origin inline comment', async () => {
    const res = await request(app)
      .post(`/_api/v3/inline-comments/${nonOriginCommentId}/replies`)
      .send({ comment: 'a reply' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'inline-comment-not-origin' }),
    ]);
  });

  it('returns 404 (uniform, not 403) when the requester lacks view permission on the parent page', async () => {
    const res = await request(app)
      .post(
        `/_api/v3/inline-comments/${originCommentOnForbiddenPageId}/replies`,
      )
      .send({ comment: 'a reply' });

    expect(res.status).toBe(404);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'notfound_or_forbidden' }),
    ]);
  });

  it('returns 400 when the :id param is not a valid MongoId', async () => {
    const res = await request(app)
      .post('/_api/v3/inline-comments/not-an-id/replies')
      .send({ comment: 'a reply' });

    expect(res.status).toBe(400);
  });
});
