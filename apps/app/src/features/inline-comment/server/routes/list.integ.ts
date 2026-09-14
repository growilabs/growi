/**
 * Integration tests for GET /_api/v3/inline-comments?pageId=... (task 3.5).
 *
 * Same passthrough-auth pattern as create.integ.ts — see that file's header.
 *
 * Requirements: 2.5, 2.6, 1.5, 1.6, 6.1
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

import { InlineCommentService } from '../service/inline-comment-service';
import { listInlineCommentsRouteHandlersFactory } from './list';

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

const FIXTURE_ROOT = '/inline-comment-list-route-integ';
const requesterUsername = 'inline-comment-list-route-integ-requester';
const ownerUsername = 'inline-comment-list-route-integ-owner';

describe('GET /_api/v3/inline-comments', () => {
  let app: express.Application;
  let crowi: Crowi;
  let requester: HydratedDocument<IUserHasId>;
  let owner: HydratedDocument<IUserHasId>;
  let publicPage: HydratedDocument<PageDocument>;
  let forbiddenPage: HydratedDocument<PageDocument>;
  let originAId: string;
  let originBId: string;

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

    // Created through the real InlineCommentService.create() — the actual
    // production write path (task 3.1, already approved) — rather than a
    // raw prisma.comments.create() with hand-picked fields. This matters
    // here: create() never sets replyToId (Prisma/Mongo then stores no
    // `replyTo` field at all), and listByPageId()'s own query filters
    // `replyToId: null`. See this file's CONCERNS in the task 3.5 status
    // report — a row seeded with an explicit `replyToId: null` would match
    // that filter and mask the real defect network (a row Mongo never wrote
    // wouldn't).
    const inlineCommentService = new InlineCommentService({
      prisma,
      commentService: crowi.commentService,
    });
    const originA = await inlineCommentService.create(
      {
        pageId: String(publicPage._id),
        anchorOriginRevisionId: String(new Types.ObjectId()),
        comment: 'origin A',
        anchor: { quote: 'quote A', prefix: '', suffix: '', approxOffset: 0 },
      },
      String(owner._id),
    );
    originAId = originA.id;

    // Guarantee originA and originB land in distinct milliseconds so the
    // createdAt-desc ordering assertion below isn't a tie-breaking coin flip.
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });

    const originB = await inlineCommentService.create(
      {
        pageId: String(publicPage._id),
        anchorOriginRevisionId: String(new Types.ObjectId()),
        comment: 'origin B',
        anchor: { quote: 'quote B', prefix: '', suffix: '', approxOffset: 0 },
      },
      String(owner._id),
    );
    originBId = originB.id;

    await prisma.comments.create({
      data: {
        pageId: String(publicPage._id),
        creatorId: String(requester._id),
        comment: 'reply to A',
        isInline: true,
        replyToId: originAId,
      },
    });

    // A non-inline (regular) comment on the same page must never appear.
    await prisma.comments.create({
      data: {
        pageId: String(publicPage._id),
        creatorId: String(owner._id),
        comment: 'a regular, non-inline comment',
        isInline: false,
      },
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
      listInlineCommentsRouteHandlersFactory(crowi),
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

  it('lists only the isInline:true origin comments for the page, each with nested replies', async () => {
    const res = await request(app)
      .get('/_api/v3/inline-comments')
      .query({ pageId: String(publicPage._id) });

    expect(res.status).toBe(200);
    const { inlineComments } = res.body;
    expect(inlineComments).toHaveLength(2);

    type ListedInlineComment = {
      id: string;
      comment: string;
      replies: Array<{ comment: string; replyToId: string }>;
    };
    const byId = new Map<string, ListedInlineComment>(
      inlineComments.map((c: ListedInlineComment) => [c.id, c]),
    );
    const originAEntry = byId.get(originAId);
    const originBEntry = byId.get(originBId);
    expect(originAEntry).toBeDefined();
    expect(originBEntry).toBeDefined();
    expect(originAEntry?.replies).toHaveLength(1);
    expect(originAEntry?.replies[0]).toMatchObject({
      comment: 'reply to A',
      replyToId: originAId,
    });
    expect(originBEntry?.replies).toEqual([]);

    // The regular (non-inline) comment must never leak into this endpoint.
    expect(
      inlineComments.some(
        (c: { comment: string }) =>
          c.comment === 'a regular, non-inline comment',
      ),
    ).toBe(false);

    // Requirement 2.6 (creation-order sort), verified against a real query
    // result — not a mock. originA was created before originB above, so
    // creation-timestamp order (desc, matching findCommentsByPageId's
    // existing convention) puts originB first.
    expect(inlineComments.map((c: ListedInlineComment) => c.id)).toEqual([
      originBId,
      originAId,
    ]);
  });

  it('returns 404 for a nonexistent pageId', async () => {
    const res = await request(app)
      .get('/_api/v3/inline-comments')
      .query({ pageId: String(new Types.ObjectId()) });

    expect(res.status).toBe(404);
  });

  it('returns 404 (uniform, not 403) when the requester lacks view permission on the page', async () => {
    const res = await request(app)
      .get('/_api/v3/inline-comments')
      .query({ pageId: String(forbiddenPage._id) });

    expect(res.status).toBe(404);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'notfound_or_forbidden' }),
    ]);
  });

  it('returns 400 when pageId is missing', async () => {
    const res = await request(app).get('/_api/v3/inline-comments');

    expect(res.status).toBe(400);
  });
});
