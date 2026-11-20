import type { IUser } from '@growi/core';
import { PageGrant } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import express from 'express';
import mongoose, { type HydratedDocument, type Model, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import apiV1FormValidator from '~/server/middlewares/apiv1-form-validator';
import { setup as certifySharedPageFactory } from '~/server/middlewares/certify-shared-page';
import loginRequiredFactory from '~/server/middlewares/login-required';
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
const LEGACY_PATH = '/_api/comments.get';
// Fixed literal so the validation table (built at collection time) never depends on beforeAll state.
const VALID_ID = '6512f0c0a1b2c3d4e5f60718';
// Values seeded on the comment author that the list response must never carry.
const CREATOR_SECRETS = {
  googleId: 'google-id-must-not-leak',
  // slackMemberId has a unique index, so keep it distinct per worker.
  slackMemberId: `slack-member-id-must-not-leak-${WORKER_ID}`,
  lastLoginAt: new Date('2021-02-03T04:05:06.000Z'),
};
const CREATOR_SUMMARY_KEYS = ['_id', 'imageUrlCached', 'name', 'username'];

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

  // A GRANT_OWNER page reachable only through its share link, with two
  // revisions so a revision-scoped request returns a strict subset.
  let sharedPageId: string;
  let sharedOldRevisionId: string;
  let sharedOldRegularCommentId: string;
  let sharedNewInlineCommentId: string;
  let shareLinkId: string;
  let expiredShareLinkId: string;

  // A public page whose comment author and one reacting user have no user document.
  let orphanPageId: string;
  let orphanCommentId: string;
  // A public page whose only reaction row is malformed, so loading reactions fails.
  let brokenPageId: string;
  let brokenCommentId: string;
  const missingCreatorId = String(new Types.ObjectId());
  const missingReactorId = String(new Types.ObjectId());

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
      path: {
        $in: [
          `${BASE}/public`,
          `${BASE}/private`,
          `${BASE}/shared`,
          `${BASE}/orphan`,
          `${BASE}/broken`,
        ],
      },
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
      ...CREATOR_SECRETS,
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

    const sharedPage = await Page.create({
      path: `${BASE}/shared`,
      grant: PageGrant.GRANT_OWNER,
      grantedUsers: [owner._id],
      creator: owner._id,
      lastUpdateUser: owner._id,
      isEmpty: true,
    });
    sharedPageId = String(sharedPage._id);
    // Explicit timestamps: old revision < old comment < new revision < new comment.
    const sharedOldRevision = await prisma.revisions.create({
      data: {
        pageId: sharedPageId,
        body: 'shared old body',
        format: 'markdown',
        authorId: String(owner._id),
        createdAt: new Date('2020-01-01T00:00:00Z'),
      },
    });
    await prisma.revisions.create({
      data: {
        pageId: sharedPageId,
        body: 'shared new body',
        format: 'markdown',
        authorId: String(owner._id),
        createdAt: new Date('2020-01-03T00:00:00Z'),
      },
    });
    sharedOldRevisionId = sharedOldRevision.id;
    sharedOldRegularCommentId = (
      await prisma.comments.create({
        data: {
          pageId: sharedPageId,
          creatorId: String(owner._id),
          revisionId: sharedOldRevisionId,
          comment: 'shared old regular comment',
          isInline: false,
          createdAt: new Date('2020-01-02T00:00:00Z'),
        },
      })
    ).id;
    sharedNewInlineCommentId = (
      await prisma.comments.create({
        data: {
          pageId: sharedPageId,
          creatorId: String(owner._id),
          comment: 'shared new inline comment',
          isInline: true,
          quote: 'shared quote',
          prefix: '',
          suffix: '',
          approxOffset: 0,
          anchorOriginRevisionId: sharedOldRevisionId,
          createdAt: new Date('2020-01-04T00:00:00Z'),
        },
      })
    ).id;
    shareLinkId = (
      await prisma.sharelinks.create({ data: { relatedPageId: sharedPageId } })
    ).id;
    expiredShareLinkId = (
      await prisma.sharelinks.create({
        data: {
          relatedPageId: sharedPageId,
          expiredAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
        },
      })
    ).id;

    const orphanPage = await Page.create({
      path: `${BASE}/orphan`,
      grant: PageGrant.GRANT_PUBLIC,
      creator: owner._id,
      lastUpdateUser: owner._id,
      isEmpty: true,
    });
    orphanPageId = String(orphanPage._id);
    orphanCommentId = (
      await prisma.comments.create({
        data: {
          pageId: orphanPageId,
          creatorId: missingCreatorId,
          comment: 'comment by a user whose document is gone',
          isInline: false,
        },
      })
    ).id;

    const brokenPage = await Page.create({
      path: `${BASE}/broken`,
      grant: PageGrant.GRANT_PUBLIC,
      creator: owner._id,
      lastUpdateUser: owner._id,
      isEmpty: true,
    });
    brokenPageId = String(brokenPage._id);
    brokenCommentId = (
      await prisma.comments.create({
        data: {
          pageId: brokenPageId,
          creatorId: String(owner._id),
          comment: 'comment whose reactions cannot be read',
          isInline: false,
        },
      })
    ).id;
    // Written around Prisma: a row lacking the required `emoji` makes the reaction read throw.
    await mongoose.connection.collection('commentreactions').insertOne({
      comment: new Types.ObjectId(brokenCommentId),
      page: new Types.ObjectId(brokenPageId),
      user: owner._id,
      createdAt: new Date(),
    });

    // Explicit createdAt values make chip order and user order deterministic.
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
          commentId: regularCommentId,
          pageId: publicPageId,
          userId: String(owner._id),
          emoji: 'unicode:tada',
          createdAt: reactionAt(3),
        },
        {
          commentId: sharedNewInlineCommentId,
          pageId: sharedPageId,
          userId: String(owner._id),
          emoji: 'unicode:eyes',
          createdAt: reactionAt(4),
        },
        {
          commentId: sharedOldRegularCommentId,
          pageId: sharedPageId,
          userId: String(viewer._id),
          emoji: 'unicode:tada',
          createdAt: reactionAt(5),
        },
        {
          commentId: orphanCommentId,
          pageId: orphanPageId,
          userId: missingReactorId,
          emoji: 'unicode:+1',
          createdAt: reactionAt(6),
        },
        {
          commentId: orphanCommentId,
          pageId: orphanPageId,
          userId: String(viewer._id),
          emoji: 'unicode:+1',
          createdAt: reactionAt(7),
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
    app.use(MOUNT_PATH, listCommentsRouteHandlersFactory(crowi));

    // The deprecated apiv1 route, wired as in routes/index.js.
    const { setup: setupComment } = await import('~/server/routes/comment');
    const legacyComment = setupComment(crowi, {});
    app.get(
      LEGACY_PATH,
      legacyComment.api.validators.get(),
      apiV1FormValidator,
      certifySharedPageFactory(crowi),
      loginRequiredFactory(crowi, true),
      legacyComment.api.get,
    );
  }, 120_000);

  afterAll(async () => {
    const pageIds = [
      publicPageId,
      forbiddenPageId,
      sharedPageId,
      orphanPageId,
      brokenPageId,
    ];
    await mongoose.connection.collection('commentreactions').deleteMany({
      page: { $in: pageIds.map((id) => new Types.ObjectId(id)) },
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

  const expectOnlyCreatorSummaries = (res: request.Response): void => {
    const comments: ICommentListItem[] = res.body.comments;
    expect(comments.length).toBeGreaterThan(0);
    for (const { creator } of comments) {
      expect(typeof creator).toBe('object');
      expect(Object.keys(creator ?? {}).sort()).toEqual(CREATOR_SUMMARY_KEYS);
    }
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(CREATOR_SECRETS.googleId);
    expect(body).not.toContain(CREATOR_SECRETS.slackMemberId);
    expect(body).not.toContain(CREATOR_SECRETS.lastLoginAt.toISOString());
    expect(body).not.toContain('@example.com');
  };

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
      expect(inline?.creator).toEqual({
        _id: String(owner._id),
        username: owner.username,
        name: owner.name,
        imageUrlCached: owner.imageUrlCached ?? null,
      });
      expectOnlyCreatorSummaries(res);
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

  describe('share-link access (Requirement 3.3, 3.4, 2.5)', () => {
    const commentIds = (res: request.Response): string[] => {
      const comments: ICommentListItem[] = res.body.comments;
      return comments.map((c) => c.id).sort();
    };

    it('returns both regular and inline comments of the shared page to a guest, even when guest read is disallowed', async () => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(false);

      const res = await getComments({ pageId: sharedPageId, shareLinkId });

      expect(res.status).toBe(200);
      expect(commentIds(res)).toEqual(
        [sharedOldRegularCommentId, sharedNewInlineCommentId].sort(),
      );
      const comments: ICommentListItem[] = res.body.comments;
      expect(
        comments.find((c) => c.id === sharedNewInlineCommentId),
      ).toMatchObject({ isInline: true, quote: 'shared quote' });
      expectOnlyCreatorSummaries(res);
    });

    it('scopes to the old revision for a non-shared viewer (control for the revision-ignored cases)', async () => {
      currentUser = owner;

      const res = await getComments({
        pageId: sharedPageId,
        revisionId: sharedOldRevisionId,
      });

      expect(res.status).toBe(200);
      expect(commentIds(res)).toEqual([sharedOldRegularCommentId]);
    });

    it.each([
      ['an old revision of the page', () => sharedOldRevisionId],
      ['a nonexistent revision', () => String(new Types.ObjectId())],
      ['a revision of a private page', () => forbiddenRevisionId],
      ['a revision of another page', () => publicRevisionId],
    ])('ignores revisionId set to %s and returns the whole page', async (_label, revisionIdOf) => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(false);
      const latest = await getComments({ pageId: sharedPageId, shareLinkId });

      const res = await getComments({
        pageId: sharedPageId,
        shareLinkId,
        revisionId: revisionIdOf(),
      });

      expect(res.status).toBe(200);
      expect(commentIds(res)).toEqual(commentIds(latest));
      expect(commentIds(res)).toHaveLength(2);
      expect(JSON.stringify(res.body)).not.toContain(
        'PRIVATE-COMMENT-MUST-NOT-LEAK',
      );
    });

    describe('a share link that is not honored falls back to normal access (Requirement 3.4)', () => {
      it('returns 403 to a guest using the share link of another page when guest read is disallowed', async () => {
        vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(
          false,
        );

        const res = await getComments({ pageId: forbiddenPageId, shareLinkId });

        expect(res.status).toBe(403);
        expect(res.body.comments).toBeUndefined();
      });

      it.each([
        ['a guest (guest read allowed)', false],
        ['a logged-in viewer', true],
      ])('returns 404 to %s using the share link of another page', async (_label, loggedIn) => {
        vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(
          true,
        );
        currentUser = loggedIn ? viewer : undefined;

        const res = await getComments({ pageId: forbiddenPageId, shareLinkId });

        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain(
          'PRIVATE-COMMENT-MUST-NOT-LEAK',
        );
      });

      it('does not honor a share link certified through page_id while pageId names another page', async () => {
        currentUser = viewer;

        const res = await getComments({
          pageId: forbiddenPageId,
          page_id: sharedPageId,
          shareLinkId,
        });

        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain(
          'PRIVATE-COMMENT-MUST-NOT-LEAK',
        );
      });

      it.each([
        ['an expired share link', () => expiredShareLinkId],
        ['a nonexistent share link', () => String(new Types.ObjectId())],
      ])('treats %s as not shared', async (_label, shareLinkIdOf) => {
        const query = { pageId: sharedPageId, shareLinkId: shareLinkIdOf() };
        const isGuestAllowedToRead = vi.spyOn(
          crowi.aclService,
          'isGuestAllowedToRead',
        );

        isGuestAllowedToRead.mockReturnValue(false);
        const withoutGuestRead = await getComments(query);
        isGuestAllowedToRead.mockReturnValue(true);
        const withGuestRead = await getComments(query);

        expect(withoutGuestRead.status).toBe(403);
        expect(withGuestRead.status).toBe(404);
        for (const res of [withoutGuestRead, withGuestRead]) {
          expect(res.body.comments).toBeUndefined();
          expect(JSON.stringify(res.body)).not.toContain('shared old regular');
        }
      });
    });
  });

  describe('reactions on each comment (comment-reactions Requirement 1.9, 1.10, 6.1, 6.2, 6.4, 6.5, 11.1, 11.5, 11.6)', () => {
    const summaryOf = (user: HydratedDocument<IUser>) => ({
      _id: String(user._id),
      username: user.username,
      name: user.name,
      imageUrlCached: user.imageUrlCached ?? null,
    });

    const reactionsOf = (
      res: request.Response,
      commentId: string,
    ): ICommentListItem['reactions'] | undefined => {
      const comments: ICommentListItem[] = res.body.comments;
      return comments.find((c) => c.id === commentId)?.reactions;
    };

    const expectedRegularChips = (myReactions: {
      plusOne: boolean;
      tada: boolean;
    }) => [
      {
        emoji: 'unicode:+1',
        count: 2,
        reactedByMe: myReactions.plusOne,
        users: [summaryOf(owner), summaryOf(viewer)],
      },
      {
        emoji: 'unicode:tada',
        count: 1,
        reactedByMe: myReactions.tada,
        users: [summaryOf(owner)],
      },
    ];

    it('carries the chips of each comment, formatted with the 4-field creator summary, and [] for a comment without reactions', async () => {
      currentUser = viewer;

      const res = await getComments({ pageId: publicPageId });

      expect(res.status).toBe(200);
      expect(reactionsOf(res, regularCommentId)).toEqual(
        expectedRegularChips({ plusOne: true, tada: false }),
      );
      expect(reactionsOf(res, inlineCommentId)).toEqual([]);
    });

    it.each([
      ['the owner', () => owner, { plusOne: true, tada: true }],
      ['a guest', () => undefined, { plusOne: false, tada: false }],
    ])('marks reactedByMe from the point of view of %s', async (_label, requesterOf, myReactions) => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(true);
      currentUser = requesterOf();

      const res = await getComments({ pageId: publicPageId });

      expect(res.status).toBe(200);
      expect(reactionsOf(res, regularCommentId)).toEqual(
        expectedRegularChips(myReactions),
      );
    });

    it('returns the same reactions to a Bearer access token holder', async () => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(false);

      const res = await getComments({ pageId: publicPageId }).set(
        'Authorization',
        `Bearer ${pageReadToken}`,
      );

      expect(res.status).toBe(200);
      expect(reactionsOf(res, regularCommentId)).toEqual(
        expectedRegularChips({ plusOne: true, tada: false }),
      );
    });

    it('returns the reactions of an inline comment through a share link', async () => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(false);

      const res = await getComments({ pageId: sharedPageId, shareLinkId });

      expect(res.status).toBe(200);
      expect(reactionsOf(res, sharedNewInlineCommentId)).toEqual([
        {
          emoji: 'unicode:eyes',
          count: 1,
          reactedByMe: false,
          users: [summaryOf(owner)],
        },
      ]);
      expect(reactionsOf(res, sharedOldRegularCommentId)).toEqual([
        {
          emoji: 'unicode:tada',
          count: 1,
          reactedByMe: false,
          users: [summaryOf(viewer)],
        },
      ]);
    });

    it('still returns the comments, with reactions null, when the reactions cannot be loaded', async () => {
      currentUser = viewer;

      const res = await getComments({ pageId: brokenPageId });

      expect(res.status).toBe(200);
      const comments: ICommentListItem[] = res.body.comments;
      expect(comments).toHaveLength(1);
      expect(comments[0]).toMatchObject({
        id: brokenCommentId,
        comment: 'comment whose reactions cannot be read',
        reactions: null,
      });
    });

    it('counts a reaction of a user whose document is gone as the bare id, the same shape as a missing author', async () => {
      currentUser = viewer;

      const res = await getComments({ pageId: orphanPageId });

      expect(res.status).toBe(200);
      const [comment]: ICommentListItem[] = res.body.comments;
      expect(comment.creator).toBe(missingCreatorId);
      expect(comment.reactions).toEqual([
        {
          emoji: 'unicode:+1',
          count: 2,
          reactedByMe: true,
          users: [missingReactorId, summaryOf(viewer)],
        },
      ]);
    });

    // Through the share link: the legacy viewer check skips empty pages, which these fixtures are.
    it('leaves the legacy comments.get response without a reactions key', async () => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(false);

      const res = await request(app)
        .get(LEGACY_PATH)
        .query({ page_id: sharedPageId, shareLinkId });

      expect(res.status).toBe(200);
      const legacyComments: Record<string, unknown>[] = res.body.comments;
      expect(legacyComments.map((c) => c._id)).toEqual([
        sharedOldRegularCommentId,
      ]);
      for (const comment of legacyComments) {
        expect(comment).not.toHaveProperty('reactions');
      }
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
