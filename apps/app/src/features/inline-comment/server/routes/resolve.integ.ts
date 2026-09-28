/**
 * Integration tests for PUT /_api/v3/inline-comments/:id/resolve (task 3.5).
 *
 * Same passthrough-auth pattern as create.integ.ts — see that file's header.
 *
 * Requirements: 4.1-4.5, 1.5, 1.6, 6.1 (inline-comment); 1.3, 1.4, 1.5
 * (inline-comment-readonly-restriction)
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
const readOnlyUsername = 'inline-comment-resolve-route-integ-readonly';

describe('PUT /_api/v3/inline-comments/:id/resolve', () => {
  let app: express.Application;
  let crowi: Crowi;
  let requester: HydratedDocument<IUserHasId>;
  let owner: HydratedDocument<IUserHasId>;
  let readOnlyUser: HydratedDocument<IUserHasId>;
  let publicPage: HydratedDocument<PageDocument>;
  let forbiddenPage: HydratedDocument<PageDocument>;
  let originCommentId: string;
  let originCommentOnForbiddenPageId: string;
  let replyCommentId: string;

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
    inlineCommentsRouter.put(
      '/:id/resolve',
      resolveInlineCommentRouteHandlersFactory(crowi),
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
      username: { $in: [requesterUsername, ownerUsername, readOnlyUsername] },
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
    // Read-only-user restriction (requirements.md Requirement 1, AC 1.3/1.4):
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

    app = mountAppAs(requester);
  }, 120_000);

  afterAll(async () => {
    const { Page } = crowi.models;
    await Page.deleteMany({
      _id: { $in: [publicPage._id, forbiddenPage._id] },
    });
    await crowi.models.User.deleteMany({
      username: { $in: [requesterUsername, ownerUsername, readOnlyUsername] },
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

  it('returns 400 when a read-only user (not allowed to comment) attempts to resolve', async () => {
    const readOnlyApp = mountAppAs(readOnlyUser);
    const res = await request(readOnlyApp)
      .put(`/_api/v3/inline-comments/${originCommentId}/resolve`)
      .send({ resolved: true });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'validation_failed' }),
    ]);
  });

  it('resolves (200) for a read-only user when the config allows it (requirement 3.3)', async () => {
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
        .put(`/_api/v3/inline-comments/${originCommentId}/resolve`)
        .send({ resolved: true });

      // Same status/body shape as the normal-user success test above — this
      // is what "unchanged success response" (requirement 3.3) means here.
      expect(res.status).toBe(200);
      expect(res.body.inlineComment.resolvedById).toBe(
        String(readOnlyUser._id),
      );
      expect(res.body.inlineComment.resolvedAt).not.toBeNull();
    } finally {
      // Leave the fixture unresolved again, as the earlier success test did.
      await request(app)
        .put(`/_api/v3/inline-comments/${originCommentId}/resolve`)
        .send({ resolved: false });
      await crowi.configManager.updateConfig(
        'security:isRomUserAllowedToComment',
        false,
      );
    }
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
