import { EventEmitter } from 'node:events';
import type { IUser } from '@growi/core';
import { PageGrant } from '@growi/core';
import express, { type RequestHandler } from 'express';
import mongoose, { type HydratedDocument, type Model } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import {
  ActionGroupSize,
  SupportedAction,
  SupportedEventModel,
  SupportedTargetModel,
} from '~/interfaces/activity';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import type { PageDocument, PageModel } from '~/server/models/page';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import { MAX_REACTION_KINDS_PER_COMMENT } from '../../interfaces';
import { updateCommentReactionRouteHandlersFactory } from './update';

// Same harness as update.integ.ts: the real middleware chain (including
// addActivity) runs, and an upstream middleware injects `req.user`. Recorded
// rows are read back from the DB, since a dropped snapshot field is invisible
// in any return value.

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const BASE = `/comment-reaction-update-activity-integ-${WORKER_ID}`;
const MOUNT_PATH = '/_api/v3/comments';
const ADD = SupportedAction.ACTION_COMMENT_REACTION_ADD;
const REMOVE = SupportedAction.ACTION_COMMENT_REACTION_REMOVE;
const REACTION_ACTIONS = [ADD, REMOVE];
const THUMBS_UP = 'unicode:+1';

describe('PUT /_api/v3/comments/:id/reactions — audit log', () => {
  let crowi: Crowi;
  let app: express.Application;
  let Page: PageModel;
  let User: Model<IUser>;

  let viewer: HydratedDocument<IUser>;
  let owner: HydratedDocument<IUser>;
  let currentUser: HydratedDocument<IUser> | undefined;

  let publicPageId: string;
  let forbiddenPageId: string;

  const viewerId = () => String(viewer._id);

  const putReaction = (commentId: string, body: object) =>
    request(app).put(`${MOUNT_PATH}/${commentId}/reactions`).send(body);

  const createPage = async (
    suffix: string,
    grant: PageGrant,
  ): Promise<string> => {
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

  const createComment = async (pageId = publicPageId): Promise<string> =>
    (
      await prisma.comments.create({
        data: {
          pageId,
          creatorId: String(owner._id),
          comment: 'comment to react to',
        },
      })
    ).id;

  const reactionRows = (commentId: string) =>
    prisma.activities.findMany({
      where: { event: commentId, action: { in: REACTION_ACTIONS } },
    });

  const waitFor = async <T>(
    read: () => Promise<T>,
    isReady: (value: T) => boolean,
    describeWait: string,
    maxWaitMs = 5000,
  ): Promise<T> => {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      // biome-ignore lint/performance/noAwaitInLoops: polling requires sequential awaits
      const value = await read();
      if (isReady(value)) {
        return value;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`timed out waiting for ${describeWait}`);
  };

  // A rejected request leaves an ACTION_UNSETTLED row once its response has
  // finished, which tells us the settle step has run and no reaction row followed.
  const waitForAttemptRow = () =>
    waitFor(
      () =>
        prisma.activities.findMany({
          where: {
            userId: viewerId(),
            action: SupportedAction.ACTION_UNSETTLED,
          },
        }),
      (rows) => rows.length > 0,
      'the ACTION_UNSETTLED attempt row',
    );

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model<IUser>('User');

    // Audit logging is off by default and Small does not record comment actions.
    await configManager.updateConfigs({
      'app:auditLogEnabled': true,
      'app:auditLogActionGroupSize': ActionGroupSize.Medium,
    });

    const viewerName = `comment-reaction-activity-viewer-${WORKER_ID}`;
    const ownerName = `comment-reaction-activity-owner-${WORKER_ID}`;
    await User.deleteMany({ username: { $in: [viewerName, ownerName] } });
    await Page.deleteMany({ path: { $regex: `^${BASE}/` } });

    const createUser = (name: string) =>
      User.create({ name, username: name, email: `${name}@example.com` });
    viewer = await createUser(viewerName);
    owner = await createUser(ownerName);

    publicPageId = await createPage('public', PageGrant.GRANT_PUBLIC);
    forbiddenPageId = await createPage('private', PageGrant.GRANT_OWNER);

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
    await prisma.activities.deleteMany({
      where: { userId: { in: [String(viewer._id), String(owner._id)] } },
    });
    await prisma.commentreactions.deleteMany({
      where: { pageId: { in: pageIds } },
    });
    await prisma.comments.deleteMany({ where: { pageId: { in: pageIds } } });
    await Page.deleteMany({ _id: { $in: pageIds } });
    await User.deleteMany({ _id: { $in: [viewer._id, owner._id] } });
    await configManager.updateConfigs(
      {
        'app:auditLogEnabled': undefined,
        'app:auditLogActionGroupSize': undefined,
      },
      { removeIfUndefined: true },
    );
  }, 30_000);

  beforeEach(async () => {
    currentUser = viewer;
    await prisma.activities.deleteMany({
      where: { userId: { in: [String(viewer._id), String(owner._id)] } },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('a request that changed the state (comment-reactions Requirement 9.1, 9.2)', () => {
    it('records one COMMENT_REACTION_ADD row with the operator, targets, emoji and username', async () => {
      const commentId = await createComment();

      const res = await putReaction(commentId, {
        emoji: THUMBS_UP,
        isReacted: true,
      });
      expect(res.status).toBe(200);
      expect(res.body.changed).toBe(true);

      const rows = await waitFor(
        () => reactionRows(commentId),
        (found) => found.length > 0,
        'the COMMENT_REACTION_ADD row',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: ADD,
        userId: viewerId(),
        target: publicPageId,
        targetModel: SupportedTargetModel.MODEL_PAGE,
        event: commentId,
        eventModel: SupportedEventModel.MODEL_COMMENT,
        snapshot: { emoji: THUMBS_UP, username: viewer.username },
      });
    });

    it('records one COMMENT_REACTION_REMOVE row with the operator, targets, emoji and username', async () => {
      const commentId = await createComment();
      await prisma.commentreactions.create({
        data: {
          commentId,
          pageId: publicPageId,
          userId: viewerId(),
          emoji: THUMBS_UP,
          createdAt: new Date(),
        },
      });

      const res = await putReaction(commentId, {
        emoji: THUMBS_UP,
        isReacted: false,
      });
      expect(res.status).toBe(200);
      expect(res.body.changed).toBe(true);

      const rows = await waitFor(
        () => reactionRows(commentId),
        (found) => found.length > 0,
        'the COMMENT_REACTION_REMOVE row',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: REMOVE,
        userId: viewerId(),
        target: publicPageId,
        targetModel: SupportedTargetModel.MODEL_PAGE,
        event: commentId,
        eventModel: SupportedEventModel.MODEL_COMMENT,
        snapshot: { emoji: THUMBS_UP, username: viewer.username },
      });
    });

    it('stores the canonical key when the request used an alias', async () => {
      const commentId = await createComment();

      await putReaction(commentId, {
        emoji: 'unicode:thumbsup',
        isReacted: true,
      });

      const rows = await waitFor(
        () => reactionRows(commentId),
        (found) => found.length > 0,
        'the COMMENT_REACTION_ADD row',
      );
      expect(rows[0].snapshot.emoji).toBe(THUMBS_UP);
    });

    it('stores the key as sent when a removed row held a key the emoji data no longer knows', async () => {
      const commentId = await createComment();
      const emoji = 'unicode:removed_in_new_data';
      await prisma.commentreactions.create({
        data: {
          commentId,
          pageId: publicPageId,
          userId: viewerId(),
          emoji,
          createdAt: new Date(),
        },
      });

      await putReaction(commentId, { emoji, isReacted: false });

      const rows = await waitFor(
        () => reactionRows(commentId),
        (found) => found.length > 0,
        'the COMMENT_REACTION_REMOVE row',
      );
      expect(rows[0]).toMatchObject({ action: REMOVE, snapshot: { emoji } });
    });

    it('keeps the operator on the row when the response finishes immediately', async () => {
      const commentId = await createComment();
      // A fake response whose apiv3() fires 'finish' synchronously reproduces
      // the context-clearing race that an emit after the response would lose.
      const emitter = new EventEmitter();
      const resState = { statusCode: 200 };
      const res = {
        locals: {} as Record<string, unknown>,
        writableFinished: false,
        get statusCode() {
          return resState.statusCode;
        },
        on: emitter.on.bind(emitter),
        apiv3: vi.fn(() => {
          emitter.emit('finish');
        }),
        apiv3Err: vi.fn(),
      } as unknown as ApiV3Response;
      const req = {
        method: 'PUT',
        ip: '10.0.0.1',
        originalUrl: `${MOUNT_PATH}/${commentId}/reactions`,
        params: { id: commentId },
        user: viewer,
        body: { emoji: THUMBS_UP, isReacted: true },
        // biome-ignore lint/suspicious/noExplicitAny: minimal Express request shape
      } as any;

      generateAddActivityMiddleware()(req, res, () => {});
      const handlers = updateCommentReactionRouteHandlersFactory(crowi);
      const terminalHandler = handlers[handlers.length - 1] as RequestHandler;
      await terminalHandler(req, res, () => {});

      expect(res.apiv3).toHaveBeenCalledTimes(1);
      const rows = await waitFor(
        () => reactionRows(commentId),
        (found) => found.length > 0,
        'the COMMENT_REACTION_ADD row',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(viewerId());
      expect(rows[0].snapshot.username).toBe(viewer.username);
    });

    it('creates no notification, not even for the comment author', async () => {
      const emitSpy = vi.spyOn(crowi.events.activity, 'emit');
      const commentId = await createComment();

      await putReaction(commentId, { emoji: THUMBS_UP, isReacted: true });

      // 'updated' is what the notification listener reacts to; waiting for it
      // proves the notify path ran before we look for notifications.
      await waitFor(
        async () => emitSpy.mock.calls.filter(([name]) => name === 'updated'),
        (calls) => calls.length > 0,
        "the 'updated' activity event",
      );
      const notifications = await mongoose
        .model('InAppNotification')
        .countDocuments({ action: { $in: REACTION_ACTIONS } });
      expect(notifications).toBe(0);
    });
  });

  describe('a request that did not add or remove anything (comment-reactions Requirement 9.4)', () => {
    it('leaves no row for an add that changed nothing', async () => {
      const commentId = await createComment();
      await putReaction(commentId, { emoji: THUMBS_UP, isReacted: true });
      await waitFor(
        () => reactionRows(commentId),
        (found) => found.length === 1,
        'the first COMMENT_REACTION_ADD row',
      );

      const res = await putReaction(commentId, {
        emoji: THUMBS_UP,
        isReacted: true,
      });
      expect(res.body.changed).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await reactionRows(commentId)).toHaveLength(1);
    });

    it('leaves no row for a removal that changed nothing', async () => {
      const commentId = await createComment();

      const res = await putReaction(commentId, {
        emoji: THUMBS_UP,
        isReacted: false,
      });
      expect(res.body.changed).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await reactionRows(commentId)).toHaveLength(0);
    });

    it('leaves no row when the page cannot be viewed', async () => {
      const commentId = await createComment(forbiddenPageId);

      const res = await putReaction(commentId, {
        emoji: THUMBS_UP,
        isReacted: true,
      });
      expect(res.status).toBe(404);

      await waitForAttemptRow();
      expect(await reactionRows(commentId)).toHaveLength(0);
    });

    it('leaves no row for an unusable emoji', async () => {
      const commentId = await createComment();

      const res = await putReaction(commentId, {
        emoji: 'unicode:no_such_emoji',
        isReacted: true,
      });
      expect(res.status).toBe(400);

      await waitForAttemptRow();
      expect(await reactionRows(commentId)).toHaveLength(0);
    });

    it('leaves no row when a new kind would exceed the limit', async () => {
      const commentId = await createComment();
      await prisma.commentreactions.createMany({
        data: Array.from(
          { length: MAX_REACTION_KINDS_PER_COMMENT },
          (_, i) => ({
            commentId,
            pageId: publicPageId,
            userId: String(owner._id),
            emoji: `unicode:seeded_kind_${i}`,
            createdAt: new Date(),
          }),
        ),
      });

      const res = await putReaction(commentId, {
        emoji: THUMBS_UP,
        isReacted: true,
      });
      expect(res.status).toBe(409);

      await waitForAttemptRow();
      expect(await reactionRows(commentId)).toHaveLength(0);
    });

    it('leaves no row when the comment is gone by the time it is read back', async () => {
      const commentId = await createComment();
      const findByIdAndViewer = Page.findByIdAndViewer.bind(Page);
      vi.spyOn(Page, 'findByIdAndViewer').mockImplementationOnce(
        async (...args) => {
          await prisma.comments.delete({ where: { id: commentId } });
          return findByIdAndViewer(...args);
        },
      );

      const res = await putReaction(commentId, {
        emoji: THUMBS_UP,
        isReacted: true,
      });
      expect(res.status).toBe(404);

      await waitForAttemptRow();
      expect(await reactionRows(commentId)).toHaveLength(0);
    });
  });
});
