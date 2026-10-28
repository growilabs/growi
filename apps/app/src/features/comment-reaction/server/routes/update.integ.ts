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

import { MAX_REACTION_KINDS_PER_COMMENT } from '../../interfaces';
import { updateCommentReactionRouteHandlersFactory } from './update';

// Same harness as comment/server/routes/get.integ.ts: the real middleware chain
// runs unmodified, an upstream middleware injects `req.user`, and the router is
// mounted as in apiv3/index.js (app.use under /_api/... so loginRequired answers
// 403 instead of redirecting to /login).

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const BASE = `/comment-reaction-update-route-integ-${WORKER_ID}`;
const MOUNT_PATH = '/_api/v3/comments';
// Fixed literal so the validation table (built at collection time) never depends on beforeAll state.
const VALID_ID = '6512f0c0a1b2c3d4e5f60719';
const PRIVATE_MARKER = 'PRIVATE-COMMENT-MUST-NOT-LEAK';
const VALID_BODY = { emoji: 'unicode:+1', isReacted: true };

describe('PUT /_api/v3/comments/:id/reactions', () => {
  let crowi: Crowi;
  let app: express.Application;
  let Page: PageModel;
  let User: Model<IUser>;

  let viewer: HydratedDocument<IUser>;
  let owner: HydratedDocument<IUser>;
  let readOnlyUser: HydratedDocument<IUser>;
  let currentUser: HydratedDocument<IUser> | undefined;

  let publicPageId: string;
  let publicCommentId: string;
  let forbiddenPageId: string;
  let forbiddenCommentId: string;
  let forbiddenPageShareLinkId: string;
  let publicPageShareLinkId: string;

  let pageWriteToken: string;
  let pageReadToken: string;

  const putReaction = (commentId: string, body: object) =>
    request(app).put(`${MOUNT_PATH}/${commentId}/reactions`).send(body);

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

  const createUser = (name: string, readOnly = false) =>
    User.create({
      name,
      username: name,
      email: `${name}@example.com`,
      readOnly,
    });

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model<IUser>('User');

    const viewerName = `comment-reaction-update-viewer-${WORKER_ID}`;
    const ownerName = `comment-reaction-update-owner-${WORKER_ID}`;
    const readOnlyName = `comment-reaction-update-readonly-${WORKER_ID}`;
    await User.deleteMany({
      username: { $in: [viewerName, ownerName, readOnlyName] },
    });
    await Page.deleteMany({ path: { $regex: `^${BASE}/` } });

    viewer = await createUser(viewerName);
    owner = await createUser(ownerName);
    readOnlyUser = await createUser(readOnlyName, true);

    publicPageId = await createPage('public', PageGrant.GRANT_PUBLIC);
    forbiddenPageId = await createPage('private', PageGrant.GRANT_OWNER);

    publicCommentId = (
      await prisma.comments.create({
        data: {
          pageId: publicPageId,
          creatorId: String(owner._id),
          comment: 'public comment',
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

    forbiddenPageShareLinkId = (
      await prisma.sharelinks.create({
        data: { relatedPageId: forbiddenPageId },
      })
    ).id;
    publicPageShareLinkId = (
      await prisma.sharelinks.create({ data: { relatedPageId: publicPageId } })
    ).id;

    const oneDayLater = new Date(Date.now() + 1000 * 60 * 60 * 24);
    pageWriteToken = (
      await AccessToken.generateToken(viewer._id, oneDayLater, [
        SCOPE.WRITE.FEATURES.PAGE,
      ])
    ).token;
    pageReadToken = (
      await AccessToken.generateToken(viewer._id, oneDayLater, [
        SCOPE.READ.FEATURES.PAGE,
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
    const commentsRouter = express.Router();
    commentsRouter.put(
      '/:id/reactions',
      updateCommentReactionRouteHandlersFactory(crowi),
    );
    app.use(MOUNT_PATH, commentsRouter);
  }, 120_000);

  afterAll(async () => {
    const pageIds = [publicPageId, forbiddenPageId];
    await prisma.commentreactions.deleteMany({
      where: { pageId: { in: pageIds } },
    });
    await prisma.comments.deleteMany({ where: { pageId: { in: pageIds } } });
    await prisma.sharelinks.deleteMany({
      where: { relatedPageId: { in: pageIds } },
    });
    await Page.deleteMany({ _id: { $in: pageIds } });
    await AccessToken.deleteAllTokensByUserId(viewer._id);
    await User.deleteMany({
      _id: { $in: [viewer._id, owner._id, readOnlyUser._id] },
    });
  }, 30_000);

  beforeEach(() => {
    currentUser = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('who may write (Requirement 5.2, 5.4, 5.5, 5.6, 5.7)', () => {
    it('rejects a guest with 403 even when guests may read', async () => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(true);

      const res = await putReaction(publicCommentId, VALID_BODY);

      expect(res.status).toBe(403);
    });

    it('rejects a guest with 403 even when the request carries a valid shareLinkId', async () => {
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(true);

      const res = await putReaction(publicCommentId, VALID_BODY).query({
        shareLinkId: publicPageShareLinkId,
      });

      expect(res.status).toBe(403);
    });

    it('does not let a shareLinkId grant a logged-in user write access to a page they cannot view', async () => {
      currentUser = viewer;

      const res = await putReaction(forbiddenCommentId, VALID_BODY).query({
        shareLinkId: forbiddenPageShareLinkId,
      });

      expect(res.status).toBe(404);
      expect(res.body.errors).toEqual([
        expect.objectContaining({ code: 'notfound_or_forbidden' }),
      ]);
      expect(JSON.stringify(res.body)).not.toContain(PRIVATE_MARKER);
    });

    it('rejects an access token lacking the page-write scope with 403', async () => {
      const res = await putReaction(publicCommentId, VALID_BODY).set(
        'Authorization',
        `Bearer ${pageReadToken}`,
      );

      expect(res.status).toBe(403);
    });

    it('lets an access token with the page-write scope reach the request checks', async () => {
      const res = await putReaction(
        String(new Types.ObjectId()),
        VALID_BODY,
      ).set('Authorization', `Bearer ${pageWriteToken}`);

      expect(res.status).toBe(404);
      expect(res.body.errors).toEqual([
        expect.objectContaining({ code: 'notfound_or_forbidden' }),
      ]);
    });

    it('rejects a read-only user while read-only users may not comment', async () => {
      currentUser = readOnlyUser;

      const res = await putReaction(publicCommentId, VALID_BODY);

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([
        expect.objectContaining({ code: 'validation_failed' }),
      ]);
    });

    it('lets a read-only user through while read-only users may comment', async () => {
      await crowi.configManager.updateConfig(
        'security:isRomUserAllowedToComment',
        true,
      );
      try {
        currentUser = readOnlyUser;

        // An emoji error can only be reported after the read-only gate passed.
        const res = await putReaction(publicCommentId, {
          emoji: 'unicode:no_such_emoji_xyz',
          isReacted: true,
        });

        expect(res.status).toBe(400);
        expect(res.body.errors).toEqual([
          expect.objectContaining({ code: 'invalid-reaction-emoji' }),
        ]);
      } finally {
        await crowi.configManager.updateConfig(
          'security:isRomUserAllowedToComment',
          false,
        );
      }
    });
  });

  describe('existence is not disclosed (Requirement 5.3)', () => {
    it('answers a comment of a page the user cannot view and a missing comment with the same 404', async () => {
      currentUser = viewer;

      const responses = await Promise.all([
        putReaction(forbiddenCommentId, VALID_BODY),
        putReaction(String(new Types.ObjectId()), VALID_BODY),
        // The page check comes before the emoji check, so even an invalid
        // emoji cannot tell a forbidden comment apart from a missing one.
        putReaction(forbiddenCommentId, {
          emoji: 'unicode:no_such_emoji_xyz',
          isReacted: false,
        }),
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

  describe('emoji that is not a usable reaction (Requirement 4.2, 4.4)', () => {
    it.each([
      ['an emoji that does not exist', 'unicode:no_such_emoji_xyz'],
      [
        'a skin tone on an emoji without skin tones',
        'unicode:100::skin-tone-2',
      ],
      ['skin-tone-1, which is not a supported tone', 'unicode:+1::skin-tone-1'],
      ['an unsupported namespace', 'custom:party'],
      ['a value that is not a reaction key', 'thumbsup'],
      // Exactly the length limit: passes input validation, fails as an emoji.
      [
        'an unknown emoji of exactly 64 characters',
        `unicode:${'a'.repeat(56)}`,
      ],
    ])('rejects %s with 400 invalid-reaction-emoji', async (_label, emoji) => {
      currentUser = viewer;

      const res = await putReaction(publicCommentId, {
        emoji,
        isReacted: true,
      });

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([
        expect.objectContaining({ code: 'invalid-reaction-emoji' }),
      ]);
    });
  });

  describe('adding and removing (Requirement 2.1, 2.2, 2.6, 2.7, 2.8, 2.9, 11.3)', () => {
    const createComment = async (): Promise<string> =>
      (
        await prisma.comments.create({
          data: {
            pageId: publicPageId,
            creatorId: String(owner._id),
            comment: 'comment to react to',
          },
        })
      ).id;
    const countRows = (commentId: string, userId: string, emoji: string) =>
      prisma.commentreactions.count({ where: { commentId, userId, emoji } });

    it('adds the requester reaction and returns the comment with its chip', async () => {
      currentUser = viewer;
      const commentId = await createComment();

      const res = await putReaction(commentId, VALID_BODY);

      expect(res.status).toBe(200);
      expect(res.body.changed).toBe(true);
      expect(res.body.comment.id).toBe(commentId);
      expect(res.body.comment.reactions).toEqual([
        expect.objectContaining({
          emoji: 'unicode:+1',
          count: 1,
          reactedByMe: true,
        }),
      ]);
      expect(await countRows(commentId, String(viewer._id), 'unicode:+1')).toBe(
        1,
      );
    });

    it("returns other users' reactions in the chip as well", async () => {
      currentUser = viewer;
      const commentId = await createComment();
      await prisma.commentreactions.create({
        data: {
          commentId,
          pageId: publicPageId,
          userId: String(owner._id),
          emoji: 'unicode:+1',
          createdAt: new Date(),
        },
      });

      const res = await putReaction(commentId, VALID_BODY);

      expect(res.status).toBe(200);
      expect(res.body.comment.reactions).toEqual([
        expect.objectContaining({
          emoji: 'unicode:+1',
          count: 2,
          reactedByMe: true,
        }),
      ]);
      expect(res.body.comment.reactions[0].users).toHaveLength(2);
    });

    it('answers changed: false and adds no row when the reaction already exists', async () => {
      currentUser = viewer;
      const commentId = await createComment();
      await putReaction(commentId, VALID_BODY);

      const res = await putReaction(commentId, VALID_BODY);

      expect(res.status).toBe(200);
      expect(res.body.changed).toBe(false);
      expect(res.body.comment.reactions).toEqual([
        expect.objectContaining({ emoji: 'unicode:+1', count: 1 }),
      ]);
      expect(await countRows(commentId, String(viewer._id), 'unicode:+1')).toBe(
        1,
      );
    });

    it('removes the reaction, then answers changed: false for a second removal', async () => {
      currentUser = viewer;
      const commentId = await createComment();
      await putReaction(commentId, VALID_BODY);

      const first = await putReaction(commentId, {
        emoji: 'unicode:+1',
        isReacted: false,
      });
      const second = await putReaction(commentId, {
        emoji: 'unicode:+1',
        isReacted: false,
      });

      expect(first.status).toBe(200);
      expect(first.body.changed).toBe(true);
      expect(first.body.comment.reactions).toEqual([]);
      expect(second.status).toBe(200);
      expect(second.body.changed).toBe(false);
      expect(await countRows(commentId, String(viewer._id), 'unicode:+1')).toBe(
        0,
      );
    });

    it('stores an alias under its canonical key', async () => {
      currentUser = viewer;
      const commentId = await createComment();

      const res = await putReaction(commentId, {
        emoji: 'unicode:thumbsup',
        isReacted: true,
      });

      expect(res.status).toBe(200);
      expect(res.body.comment.reactions).toEqual([
        expect.objectContaining({ emoji: 'unicode:+1' }),
      ]);
    });

    it('removes a legacy row stored under an alias key via the alias the client sent', async () => {
      currentUser = viewer;
      const commentId = await createComment();
      await prisma.commentreactions.create({
        data: {
          commentId,
          pageId: publicPageId,
          userId: String(viewer._id),
          emoji: 'unicode:thumbsup',
          createdAt: new Date(),
        },
      });

      const res = await putReaction(commentId, {
        emoji: 'unicode:thumbsup',
        isReacted: false,
      });

      expect(res.status).toBe(200);
      expect(res.body.changed).toBe(true);
      expect(
        await countRows(commentId, String(viewer._id), 'unicode:thumbsup'),
      ).toBe(0);
    });

    it.each([
      [
        'an id missing from the current emoji data',
        'unicode:removed_in_new_data',
      ],
      [
        'a skin tone on an emoji without skin tones',
        'unicode:100::skin-tone-2',
      ],
    ])('removes a row stored under %s', async (_label, emoji) => {
      currentUser = viewer;
      const commentId = await createComment();
      await prisma.commentreactions.create({
        data: {
          commentId,
          pageId: publicPageId,
          userId: String(viewer._id),
          emoji,
          createdAt: new Date(),
        },
      });

      const res = await putReaction(commentId, { emoji, isReacted: false });

      expect(res.status).toBe(200);
      expect(res.body.changed).toBe(true);
      expect(await countRows(commentId, String(viewer._id), emoji)).toBe(0);
    });

    it.each([
      ['an unsupported namespace', 'custom:party'],
      ['a value that is not a reaction key', 'thumbsup'],
    ])('rejects removing %s with 400 invalid-reaction-emoji', async (_label, emoji) => {
      currentUser = viewer;
      const commentId = await createComment();

      const res = await putReaction(commentId, { emoji, isReacted: false });

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([
        expect.objectContaining({ code: 'invalid-reaction-emoji' }),
      ]);
    });

    it('lets the author react to their own comment', async () => {
      currentUser = owner;
      const commentId = await createComment();

      const res = await putReaction(commentId, VALID_BODY);

      expect(res.status).toBe(200);
      expect(res.body.changed).toBe(true);
      expect(await countRows(commentId, String(owner._id), 'unicode:+1')).toBe(
        1,
      );
    });

    describe('at the kind limit (Requirement 7.2, 7.3)', () => {
      const seedFullComment = async (): Promise<string> => {
        const commentId = await createComment();
        await prisma.commentreactions.createMany({
          data: [
            'unicode:+1',
            ...Array.from(
              { length: MAX_REACTION_KINDS_PER_COMMENT - 1 },
              (_, i) => `unicode:seeded_kind_${i}`,
            ),
          ].map((emoji) => ({
            commentId,
            pageId: publicPageId,
            userId: String(owner._id),
            emoji,
            createdAt: new Date(),
          })),
        });
        return commentId;
      };

      it('rejects a new kind with 409 and adds no row', async () => {
        currentUser = viewer;
        const commentId = await seedFullComment();

        const res = await putReaction(commentId, {
          emoji: 'unicode:tada',
          isReacted: true,
        });

        expect(res.status).toBe(409);
        expect(res.body.errors).toEqual([
          expect.objectContaining({ code: 'reaction-kind-limit-exceeded' }),
        ]);
        expect(
          await countRows(commentId, String(viewer._id), 'unicode:tada'),
        ).toBe(0);
      });

      it('still lets the requester add an existing kind', async () => {
        currentUser = viewer;
        const commentId = await seedFullComment();

        const res = await putReaction(commentId, VALID_BODY);

        expect(res.status).toBe(200);
        expect(res.body.changed).toBe(true);
        expect(res.body.comment.reactions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ emoji: 'unicode:+1', count: 2 }),
          ]),
        );
      });
    });

    it('answers 404 when the comment is gone by the time it is read back', async () => {
      currentUser = viewer;
      const commentId = await createComment();
      const findByIdAndViewer = Page.findByIdAndViewer.bind(Page);
      vi.spyOn(Page, 'findByIdAndViewer').mockImplementationOnce(
        async (...args) => {
          await prisma.comments.delete({ where: { id: commentId } });
          return findByIdAndViewer(...args);
        },
      );

      const res = await putReaction(commentId, VALID_BODY);

      expect(res.status).toBe(404);
      expect(res.body.errors).toEqual([
        expect.objectContaining({ code: 'notfound_or_forbidden' }),
      ]);
      expect(
        await prisma.commentreactions.count({ where: { commentId } }),
      ).toBe(0);
    });

    it('answers 200 with reactions: null when only the reactions cannot be read back', async () => {
      currentUser = viewer;
      const commentId = await createComment();
      // Written around Prisma: a row lacking the required `emoji` makes the reaction read throw.
      const { insertedId } = await mongoose.connection
        .collection('commentreactions')
        .insertOne({
          comment: new Types.ObjectId(commentId),
          page: new Types.ObjectId(publicPageId),
          user: owner._id,
          createdAt: new Date(),
        });
      try {
        const res = await putReaction(commentId, {
          emoji: 'unicode:+1',
          isReacted: false,
        });

        expect(res.status).toBe(200);
        expect(res.body.changed).toBe(false);
        expect(res.body.comment.id).toBe(commentId);
        expect(res.body.comment.reactions).toBeNull();
      } finally {
        await mongoose.connection
          .collection('commentreactions')
          .deleteOne({ _id: insertedId });
      }
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

      const res = await putReaction(publicCommentId, VALID_BODY);

      expect(res.status).toBe(500);
      expect(res.body.errors).toEqual([
        expect.objectContaining({ code: 'comment-reaction-update-failed' }),
      ]);
      expect(JSON.stringify(res.body)).not.toContain('SECRET-INTERNAL-DETAIL');
    });
  });

  describe('malformed input', () => {
    it.each<[string, string, object]>([
      ['an id that is not an ObjectId', 'not-an-object-id', VALID_BODY],
      [
        'an emoji sent as an array',
        VALID_ID,
        { emoji: ['unicode:+1'], isReacted: true },
      ],
      [
        'an emoji longer than 64 characters',
        VALID_ID,
        { emoji: `unicode:${'a'.repeat(57)}`, isReacted: true },
      ],
      [
        'isReacted sent as the string "true"',
        VALID_ID,
        { emoji: 'unicode:+1', isReacted: 'true' },
      ],
      ['a missing emoji', VALID_ID, { isReacted: true }],
      ['a missing isReacted', VALID_ID, { emoji: 'unicode:+1' }],
    ])('rejects %s with 400 validation_failed', async (_label, commentId, body) => {
      currentUser = viewer;

      const res = await putReaction(commentId, body);

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'validation_failed' }),
        ]),
      );
    });
  });
});
