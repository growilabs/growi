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
import { listCommentsRouteHandlersFactory } from './list';

// The real accessTokenParser / guest-allowed loginRequired / certifySharedPage
// run unmodified; an upstream middleware stands in for session resolution by
// injecting `req.user`, and guest-read is controlled per test via a spy.

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const BASE = `/comment-list-route-integ-${WORKER_ID}`;
const MOUNT_PATH = '/_api/v3/comments';
// Fixed literal so the validation table (built at collection time) never depends on beforeAll state.
const VALID_ID = '6512f0c0a1b2c3d4e5f60718';

describe('GET /_api/v3/comments', () => {
  let crowi: Crowi;
  let app: express.Application;
  let Page: PageModel;
  let User: Model<IUser>;

  let viewer: HydratedDocument<IUser>;
  let owner: HydratedDocument<IUser>;
  let currentUser: HydratedDocument<IUser> | undefined;

  let publicPageId: string;
  let forbiddenPageId: string;
  let publicRevisionId: string;
  let forbiddenRevisionId: string;
  let regularCommentId: string;
  let inlineCommentId: string;

  let pageReadToken: string;
  let wrongScopeToken: string;

  const getComments = (query: Record<string, unknown>) =>
    request(app).get(MOUNT_PATH).query(query);

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model<IUser>('User');

    const viewerName = `comment-list-route-viewer-${WORKER_ID}`;
    const ownerName = `comment-list-route-owner-${WORKER_ID}`;
    await User.deleteMany({ username: { $in: [viewerName, ownerName] } });
    await Page.deleteMany({
      path: { $in: [`${BASE}/public`, `${BASE}/private`] },
    });

    viewer = await User.create({
      name: viewerName,
      username: viewerName,
      email: `${viewerName}@example.com`,
    });
    owner = await User.create({
      name: ownerName,
      username: ownerName,
      email: `${ownerName}@example.com`,
      isEmailPublished: false,
    });

    // isEmpty: constructBasicPageInfo() only dereferences page.revision for
    // non-empty pages, and these fixtures need no page body.
    const publicPage = await Page.create({
      path: `${BASE}/public`,
      grant: PageGrant.GRANT_PUBLIC,
      creator: owner._id,
      lastUpdateUser: owner._id,
      isEmpty: true,
    });
    const forbiddenPage = await Page.create({
      path: `${BASE}/private`,
      grant: PageGrant.GRANT_OWNER,
      grantedUsers: [owner._id],
      creator: owner._id,
      lastUpdateUser: owner._id,
      isEmpty: true,
    });
    publicPageId = String(publicPage._id);
    forbiddenPageId = String(forbiddenPage._id);

    const publicRevision = await prisma.revisions.create({
      data: {
        pageId: publicPageId,
        body: 'public body',
        format: 'markdown',
        authorId: String(owner._id),
      },
    });
    const forbiddenRevision = await prisma.revisions.create({
      data: {
        pageId: forbiddenPageId,
        body: 'private body',
        format: 'markdown',
        authorId: String(owner._id),
      },
    });
    publicRevisionId = publicRevision.id;
    forbiddenRevisionId = forbiddenRevision.id;

    const regular = await prisma.comments.create({
      data: {
        pageId: publicPageId,
        creatorId: String(owner._id),
        revisionId: publicRevisionId,
        comment: 'regular comment',
        isInline: false,
      },
    });
    const inline = await prisma.comments.create({
      data: {
        pageId: publicPageId,
        creatorId: String(owner._id),
        comment: 'inline comment',
        isInline: true,
        quote: 'quoted',
        prefix: '',
        suffix: '',
        approxOffset: 0,
        anchorOriginRevisionId: publicRevisionId,
      },
    });
    regularCommentId = regular.id;
    inlineCommentId = inline.id;
    await prisma.comments.create({
      data: {
        pageId: forbiddenPageId,
        creatorId: String(owner._id),
        comment: 'PRIVATE-COMMENT-MUST-NOT-LEAK',
      },
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
    app.use(MOUNT_PATH, listCommentsRouteHandlersFactory(crowi));
  }, 120_000);

  afterAll(async () => {
    await prisma.comments.deleteMany({
      where: { pageId: { in: [publicPageId, forbiddenPageId] } },
    });
    await prisma.revisions.deleteMany({
      where: { pageId: { in: [publicPageId, forbiddenPageId] } },
    });
    await Page.deleteMany({ _id: { $in: [publicPageId, forbiddenPageId] } });
    await AccessToken.deleteAllTokensByUserId(viewer._id);
    await User.deleteMany({ _id: { $in: [viewer._id, owner._id] } });
  }, 30_000);

  beforeEach(() => {
    currentUser = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('authenticated access (Requirement 3.1, 3.2)', () => {
    it('returns both regular and inline comments, serialized, to a logged-in viewer', async () => {
      currentUser = viewer;

      const res = await getComments({ pageId: publicPageId });

      expect(res.status).toBe(200);
      const comments: ICommentListItem[] = res.body.comments;
      expect(comments.map((c) => c.id).sort()).toEqual(
        [regularCommentId, inlineCommentId].sort(),
      );
      const inline = comments.find((c) => c.id === inlineCommentId);
      expect(inline).toMatchObject({
        _id: inlineCommentId,
        page: publicPageId,
        isInline: true,
        quote: 'quoted',
      });
      expect(inline?.creator).toMatchObject({ username: owner.username });
      expect(JSON.stringify(res.body)).not.toContain(
        `${owner.username}@example.com`,
      );
    });

    it('returns comments for a Bearer access token with the page-read scope, even when guest read is disallowed', async () => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(false);

      const res = await getComments({ pageId: publicPageId }).set(
        'Authorization',
        `Bearer ${pageReadToken}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.comments).toHaveLength(2);
    });

    it('rejects an access token lacking the page-read scope as unauthenticated', async () => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(false);

      const res = await getComments({ pageId: publicPageId }).set(
        'Authorization',
        `Bearer ${wrongScopeToken}`,
      );

      expect(res.status).toBe(403);
      expect(res.body.comments).toBeUndefined();
    });
  });

  describe('unauthenticated access (Requirement 3.6, 3.7)', () => {
    it('returns 403 to an anonymous caller when guest read is disallowed', async () => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(false);

      const res = await getComments({ pageId: publicPageId });

      expect(res.status).toBe(403);
      expect(res.body.comments).toBeUndefined();
    });

    it('returns the comments of a guest-visible page when guest read is allowed', async () => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(true);

      const res = await getComments({ pageId: publicPageId });

      expect(res.status).toBe(200);
      expect(res.body.comments).toHaveLength(2);
    });

    it('returns 404 for a page the guest cannot view, even when guest read is allowed', async () => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(true);

      const res = await getComments({ pageId: forbiddenPageId });

      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain(
        'PRIVATE-COMMENT-MUST-NOT-LEAK',
      );
    });
  });

  describe('existence is not disclosed (Requirement 3.5, 2.4)', () => {
    it('answers a forbidden page, a missing page, and a missing or foreign revision with the same 404', async () => {
      currentUser = viewer;

      const responses = await Promise.all([
        getComments({ pageId: forbiddenPageId }),
        getComments({ pageId: String(new Types.ObjectId()) }),
        getComments({ pageId: publicPageId, revisionId: forbiddenRevisionId }),
        getComments({
          pageId: publicPageId,
          revisionId: String(new Types.ObjectId()),
        }),
      ]);

      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(responses[0].body);
      }
      expect(responses[0].body.errors).toEqual([
        expect.objectContaining({ code: 'notfound_or_forbidden' }),
      ]);
      expect(JSON.stringify(responses[0].body)).not.toContain(forbiddenPageId);
    });

    it('accepts a revision that belongs to the page', async () => {
      currentUser = viewer;

      const res = await getComments({
        pageId: publicPageId,
        revisionId: publicRevisionId,
      });

      expect(res.status).toBe(200);
      expect(res.body.comments).toHaveLength(2);
    });
  });

  describe('input validation (Requirement 1.8)', () => {
    it.each([
      ['missing pageId', {}],
      ['non-MongoId pageId', { pageId: 'not-an-id' }],
      ['array pageId', { pageId: [VALID_ID, VALID_ID] }],
      ['object pageId', { 'pageId[$ne]': VALID_ID }],
      ['non-MongoId revisionId', { pageId: VALID_ID, revisionId: 'x' }],
      ['non-MongoId shareLinkId', { pageId: VALID_ID, shareLinkId: 'x' }],
    ])('returns 400 for %s', async (_label, query) => {
      currentUser = viewer;

      const res = await getComments(query);

      expect(res.status).toBe(400);
      expect(res.body.comments).toBeUndefined();
    });
  });

  describe('unexpected failure (Requirement 3.9)', () => {
    it('returns a generic 500 without internal details', async () => {
      currentUser = viewer;
      vi.spyOn(prisma.comments, 'findMany').mockRejectedValueOnce(
        new Error('SECRET-INTERNAL-DETAIL'),
      );

      const res = await getComments({ pageId: publicPageId });

      expect(res.status).toBe(500);
      expect(res.body.errors).toEqual([
        expect.objectContaining({ code: 'comment-list-failed' }),
      ]);
      expect(JSON.stringify(res.body)).not.toContain('SECRET-INTERNAL-DETAIL');
    });
  });
});
