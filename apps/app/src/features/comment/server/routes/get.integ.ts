import type { IUser } from '@growi/core';
import { PageGrant } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import express from 'express';
import mongoose, { type HydratedDocument, type Model, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import { AccessToken } from '~/server/models/access-token';
import type { PageDocument, PageModel } from '~/server/models/page';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { prisma } from '~/utils/prisma';

import type { ICommentListItem } from '../../interfaces';
import { getCommentRouteHandlersFactory } from './get';
import { listCommentsRouteHandlersFactory } from './list';

// Same harness as list.integ.ts: the real middleware chain runs unmodified, an
// upstream middleware injects `req.user`, and guest-read is spied per test.
// Both routes are mounted as in apiv3/index.js so each case can compare them.

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const BASE = `/comment-get-route-integ-${WORKER_ID}`;
const MOUNT_PATH = '/_api/v3/comments';
// Fixed literal so the validation table (built at collection time) never depends on beforeAll state.
const VALID_ID = '6512f0c0a1b2c3d4e5f60718';
const PRIVATE_MARKER = 'PRIVATE-COMMENT-MUST-NOT-LEAK';

describe('GET /_api/v3/comments/:id', () => {
  let crowi: Crowi;
  let app: express.Application;
  let Page: PageModel;
  let User: Model<IUser>;

  let viewer: HydratedDocument<IUser>;
  let owner: HydratedDocument<IUser>;
  let currentUser: HydratedDocument<IUser> | undefined;

  let publicPageId: string;
  let regularCommentId: string;
  let inlineCommentId: string;
  let otherPageId: string;
  let otherPageCommentId: string;
  let forbiddenPageId: string;
  let forbiddenCommentId: string;
  // A GRANT_OWNER page reachable only through its share link.
  let sharedPageId: string;
  let sharedInlineCommentId: string;
  let shareLinkId: string;

  let pageReadToken: string;
  let wrongScopeToken: string;

  const getComment = (commentId: string, query: Record<string, unknown>) =>
    request(app).get(`${MOUNT_PATH}/${commentId}`).query(query);
  const listComments = (query: Record<string, unknown>) =>
    request(app).get(MOUNT_PATH).query(query);

  const listItemOf = (
    listRes: request.Response,
    commentId: string,
  ): ICommentListItem | undefined => {
    const comments: ICommentListItem[] = listRes.body.comments;
    return comments.find((c) => c.id === commentId);
  };

  const createPage = async (
    suffix: string,
    grant: PageGrant,
  ): Promise<string> => {
    // isEmpty: constructBasicPageInfo() only dereferences page.revision for
    // non-empty pages, and these fixtures need no page body.
    const page = await Page.create({
      path: `${BASE}/${suffix}`,
      grant,
      grantedUsers: grant === PageGrant.GRANT_OWNER ? [owner._id] : [],
      creator: owner._id,
      lastUpdateUser: owner._id,
      isEmpty: true,
    });
    return String(page._id);
  };

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model<IUser>('User');

    const viewerName = `comment-get-route-viewer-${WORKER_ID}`;
    const ownerName = `comment-get-route-owner-${WORKER_ID}`;
    await User.deleteMany({ username: { $in: [viewerName, ownerName] } });
    await Page.deleteMany({ path: { $regex: `^${BASE}/` } });

    viewer = await User.create({
      name: viewerName,
      username: viewerName,
      email: `${viewerName}@example.com`,
    });
    owner = await User.create({
      name: ownerName,
      username: ownerName,
      email: `${ownerName}@example.com`,
    });

    publicPageId = await createPage('public', PageGrant.GRANT_PUBLIC);
    otherPageId = await createPage('other', PageGrant.GRANT_PUBLIC);
    forbiddenPageId = await createPage('private', PageGrant.GRANT_OWNER);
    sharedPageId = await createPage('shared', PageGrant.GRANT_OWNER);

    const publicRevision = await prisma.revisions.create({
      data: {
        pageId: publicPageId,
        body: 'public body',
        format: 'markdown',
        authorId: String(owner._id),
      },
    });
    regularCommentId = (
      await prisma.comments.create({
        data: {
          pageId: publicPageId,
          creatorId: String(owner._id),
          revisionId: publicRevision.id,
          comment: 'regular comment',
          isInline: false,
        },
      })
    ).id;
    inlineCommentId = (
      await prisma.comments.create({
        data: {
          pageId: publicPageId,
          creatorId: String(owner._id),
          comment: 'inline comment',
          isInline: true,
          quote: 'quoted',
          prefix: '',
          suffix: '',
          approxOffset: 0,
          anchorOriginRevisionId: publicRevision.id,
        },
      })
    ).id;
    otherPageCommentId = (
      await prisma.comments.create({
        data: {
          pageId: otherPageId,
          creatorId: String(owner._id),
          comment: 'comment of another public page',
        },
      })
    ).id;
    forbiddenCommentId = (
      await prisma.comments.create({
        data: {
          pageId: forbiddenPageId,
          creatorId: String(owner._id),
          comment: PRIVATE_MARKER,
        },
      })
    ).id;
    sharedInlineCommentId = (
      await prisma.comments.create({
        data: {
          pageId: sharedPageId,
          creatorId: String(owner._id),
          comment: 'shared inline comment',
          isInline: true,
          quote: 'shared quote',
          prefix: '',
          suffix: '',
          approxOffset: 0,
        },
      })
    ).id;
    shareLinkId = (
      await prisma.sharelinks.create({ data: { relatedPageId: sharedPageId } })
    ).id;

    const reactionAt = (minute: number): Date =>
      new Date(Date.UTC(2026, 0, 1, 0, minute));
    await prisma.commentreactions.createMany({
      data: [
        {
          commentId: regularCommentId,
          pageId: publicPageId,
          userId: String(owner._id),
          emoji: 'unicode:+1',
          createdAt: reactionAt(1),
        },
        {
          commentId: regularCommentId,
          pageId: publicPageId,
          userId: String(viewer._id),
          emoji: 'unicode:+1',
          createdAt: reactionAt(2),
        },
        {
          commentId: sharedInlineCommentId,
          pageId: sharedPageId,
          userId: String(owner._id),
          emoji: 'unicode:eyes',
          createdAt: reactionAt(3),
        },
      ],
    });

    const oneDayLater = new Date(Date.now() + 1000 * 60 * 60 * 24);
    pageReadToken = (
      await AccessToken.generateToken(viewer._id, oneDayLater, [
        SCOPE.READ.FEATURES.PAGE,
      ])
    ).token;
    wrongScopeToken = (
      await AccessToken.generateToken(viewer._id, oneDayLater, [
        SCOPE.READ.USER_SETTINGS.INFO,
      ])
    ).token;

    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);

    app = express();
    app.use(express.json());
    app.use((req: CrowiRequest, res, next) => {
      Object.assign(res, responseHelpers.response);
      if (currentUser != null) {
        req.user = currentUser;
      }
      next();
    });
    // Mounted with app.use so req.baseUrl matches /_api/..., which is what
    // makes loginRequired answer 403 instead of redirecting to /login.
    const commentsRouter = express.Router();
    commentsRouter.get('/', listCommentsRouteHandlersFactory(crowi));
    commentsRouter.get('/:id', getCommentRouteHandlersFactory(crowi));
    app.use(MOUNT_PATH, commentsRouter);
  }, 120_000);

  afterAll(async () => {
    const pageIds = [publicPageId, otherPageId, forbiddenPageId, sharedPageId];
    await prisma.commentreactions.deleteMany({
      where: { pageId: { in: pageIds } },
    });
    await prisma.comments.deleteMany({ where: { pageId: { in: pageIds } } });
    await prisma.revisions.deleteMany({ where: { pageId: { in: pageIds } } });
    await prisma.sharelinks.deleteMany({
      where: { relatedPageId: { in: pageIds } },
    });
    await Page.deleteMany({ _id: { $in: pageIds } });
    await AccessToken.deleteAllTokensByUserId(viewer._id);
    await User.deleteMany({ _id: { $in: [viewer._id, owner._id] } });
  }, 30_000);

  beforeEach(() => {
    currentUser = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('same content as the list (comment-reactions Requirement 11.2, 6.4)', () => {
    it.each([
      ['a regular comment with reactions', () => regularCommentId],
      ['an inline comment', () => inlineCommentId],
    ])('returns %s exactly as the matching GET /comments item', async (_label, commentIdOf) => {
      currentUser = viewer;

      const [listRes, res] = await Promise.all([
        listComments({ pageId: publicPageId }),
        getComment(commentIdOf(), { pageId: publicPageId }),
      ]);

      expect(listRes.status).toBe(200);
      expect(res.status).toBe(200);
      const expected = listItemOf(listRes, commentIdOf());
      expect(expected).toBeDefined();
      expect(res.body.comment).toEqual(expected);
    });

    it('carries the reaction chips from the requester point of view', async () => {
      currentUser = viewer;

      const res = await getComment(regularCommentId, { pageId: publicPageId });

      expect(res.status).toBe(200);
      const comment: ICommentListItem = res.body.comment;
      expect(comment.reactions).toEqual([
        expect.objectContaining({
          emoji: 'unicode:+1',
          count: 2,
          reactedByMe: true,
        }),
      ]);
      expect(JSON.stringify(res.body)).not.toContain('@example.com');
    });
  });

  describe('existence is not disclosed (comment-reactions Requirement 6.1)', () => {
    it('answers a forbidden page, a missing comment, and a comment of another page with the same 404', async () => {
      currentUser = viewer;

      const responses = await Promise.all([
        getComment(forbiddenCommentId, { pageId: forbiddenPageId }),
        getComment(String(new Types.ObjectId()), { pageId: publicPageId }),
        getComment(otherPageCommentId, { pageId: publicPageId }),
        getComment(forbiddenCommentId, { pageId: publicPageId }),
      ]);

      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(responses[0].body);
        expect(JSON.stringify(res.body)).not.toContain(PRIVATE_MARKER);
      }
      expect(responses[0].body.errors).toEqual([
        expect.objectContaining({ code: 'notfound_or_forbidden' }),
      ]);
    });
  });

  describe('share-link access (comment-reactions Requirement 6.1)', () => {
    it('returns an inline comment of the shared page to a guest, the same as the list through the link', async () => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(false);

      const [listRes, res] = await Promise.all([
        listComments({ pageId: sharedPageId, shareLinkId }),
        getComment(sharedInlineCommentId, {
          pageId: sharedPageId,
          shareLinkId,
        }),
      ]);

      expect(res.status).toBe(200);
      expect(res.body.comment).toMatchObject({
        id: sharedInlineCommentId,
        isInline: true,
        quote: 'shared quote',
      });
      expect(res.body.comment).toEqual(
        listItemOf(listRes, sharedInlineCommentId),
      );
    });

    it.each([
      ['a public page', () => regularCommentId],
      ['a private page', () => forbiddenCommentId],
    ])('returns 404 for a comment of %s requested through the share link of another page', async (_label, commentIdOf) => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(false);

      const res = await getComment(commentIdOf(), {
        pageId: sharedPageId,
        shareLinkId,
      });

      expect(res.status).toBe(404);
      expect(res.body.errors).toEqual([
        expect.objectContaining({ code: 'notfound_or_forbidden' }),
      ]);
      expect(res.body.comment).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(PRIVATE_MARKER);
    });
  });

  describe('guest and access-token access match the list (comment-reactions Requirement 6.1, 11.6)', () => {
    type AccessCase = {
      guestAllowed: boolean;
      token?: () => string;
      pageId: () => string;
      commentId: () => string;
      status: number;
    };

    it.each<[string, AccessCase]>([
      [
        'a guest when guest read is allowed',
        {
          guestAllowed: true,
          pageId: () => publicPageId,
          commentId: () => regularCommentId,
          status: 200,
        },
      ],
      [
        'a guest when guest read is disallowed',
        {
          guestAllowed: false,
          pageId: () => publicPageId,
          commentId: () => regularCommentId,
          status: 403,
        },
      ],
      [
        'a guest on a page it cannot view',
        {
          guestAllowed: true,
          pageId: () => forbiddenPageId,
          commentId: () => forbiddenCommentId,
          status: 404,
        },
      ],
      [
        'an access token with the page-read scope',
        {
          guestAllowed: false,
          token: () => pageReadToken,
          pageId: () => publicPageId,
          commentId: () => regularCommentId,
          status: 200,
        },
      ],
      [
        'an access token lacking the page-read scope',
        {
          guestAllowed: false,
          token: () => wrongScopeToken,
          pageId: () => publicPageId,
          commentId: () => regularCommentId,
          status: 403,
        },
      ],
    ])('answers %s with the same status as GET /comments', async (_label, c) => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(
        c.guestAllowed,
      );
      const withToken = (req: request.Test): request.Test =>
        c.token == null ? req : req.set('Authorization', `Bearer ${c.token()}`);

      const listRes = await withToken(listComments({ pageId: c.pageId() }));
      const res = await withToken(
        getComment(c.commentId(), { pageId: c.pageId() }),
      );

      expect(listRes.status).toBe(c.status);
      expect(res.status).toBe(c.status);
      if (c.status === 200) {
        expect(res.body.comment).toEqual(listItemOf(listRes, c.commentId()));
      } else {
        expect(res.body.comment).toBeUndefined();
      }
    });
  });

  describe('input validation', () => {
    it.each([
      ['non-MongoId id', 'not-an-id', { pageId: VALID_ID }],
      ['missing pageId', VALID_ID, {}],
      ['non-MongoId pageId', VALID_ID, { pageId: 'not-an-id' }],
      ['array pageId', VALID_ID, { pageId: [VALID_ID, VALID_ID] }],
      ['object pageId', VALID_ID, { 'pageId[$ne]': VALID_ID }],
      [
        'non-MongoId shareLinkId',
        VALID_ID,
        { pageId: VALID_ID, shareLinkId: 'x' },
      ],
    ])('returns 400 for %s', async (_label, commentId, query) => {
      currentUser = viewer;

      const res = await getComment(commentId, query);

      expect(res.status).toBe(400);
      expect(res.body.comment).toBeUndefined();
    });
  });

  describe('unexpected failure', () => {
    it('returns a generic 500 without internal details', async () => {
      currentUser = viewer;
      vi.spyOn(
        crowi.pageService,
        'constructBasicPageInfo',
      ).mockImplementationOnce(() => {
        throw new Error('SECRET-INTERNAL-DETAIL');
      });

      const res = await getComment(regularCommentId, { pageId: publicPageId });

      expect(res.status).toBe(500);
      expect(res.body.errors).toEqual([
        expect.objectContaining({ code: 'comment-get-failed' }),
      ]);
      expect(JSON.stringify(res.body)).not.toContain('SECRET-INTERNAL-DETAIL');
    });
  });
});
