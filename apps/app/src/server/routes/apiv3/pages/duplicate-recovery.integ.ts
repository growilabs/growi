/**
 * Integration coverage for a recursive POST /pages/duplicate whose descendant
 * run is still in progress, fails, or stalls: the overlapping operations it
 * refuses, and the recovery that attaches the partial copy and notifies only
 * the duplicating user.
 *
 * The descendant run is held at its first normalizeParentRecursively call for
 * the copy (the copied descendants exist but are not on the page tree yet), so
 * that whatever attaches them afterwards is the code under test.
 */

import {
  type IUserHasId,
  PageGrant,
  SubscriptionStatusType,
} from '@growi/core';
import { ConfigSource } from '@growi/core/dist/interfaces';
import { escapeStringForMongoRegex } from '@growi/core/dist/utils';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import { PageActionType } from '~/interfaces/page-operation';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument, PageModel } from '~/server/models/page';
import PageOperation from '~/server/models/page-operation';
import Subscription from '~/server/models/subscription';
import { UserStatus } from '~/server/models/user/conts';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { STALL_THRESHOLD_MS } from '~/server/service/page/duplicate/duplicate-page-operation';
import { InterruptedDuplicateRecoveryCronService } from '~/server/service/page/duplicate/interrupted-duplicate-recovery-cron';
import { prisma } from '~/utils/prisma';

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

vi.mock('~/server/middlewares/admin-required', () => ({
  default: () => passthroughMiddleware,
}));

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PATH_ROOT = `/duplicate-recovery-route-integ-${WORKER_ID}`;
const USERNAME_PREFIX = `duplicateRecoveryRouteInteg${WORKER_ID}`;
const INTERRUPTED = SupportedAction.ACTION_PAGE_DUPLICATE_INTERRUPTED;

const fixturePathPattern = new RegExp(
  `^${escapeStringForMongoRegex(PATH_ROOT)}(/|$)`,
);

const newId = (): string => new Types.ObjectId().toHexString();

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (err: Error) => void;
}

const createDeferred = (): Deferred => {
  let resolve: () => void = () => {};
  let reject: (err: Error) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('POST /duplicate with descendants: overlapping operations and recovery', () => {
  let app: express.Application;
  let crowi: Crowi;
  let Page: PageModel;
  let requester: HydratedDocument<IUserHasId>;
  let otherUser: HydratedDocument<IUserHasId>;
  let rootId: Types.ObjectId;
  let rootDescendantCount: number;
  let isV5CompatibleInDbBefore: boolean | undefined;
  const createdUserIds: string[] = [];

  const createUser = async (
    name: string,
  ): Promise<HydratedDocument<IUserHasId>> => {
    const username = `${USERNAME_PREFIX}${name}`;
    const user = await mongoose.model<IUserHasId>('User').create({
      name: username,
      username,
      email: `${username}@example.com`,
      // Only active users are reached through a page subscription.
      status: UserStatus.STATUS_ACTIVE,
    });
    createdUserIds.push(String(user._id));
    return user;
  };

  const createPageWithRevision = async (
    path: string,
    parent: Types.ObjectId,
    descendantCount = 0,
  ): Promise<HydratedDocument<PageDocument>> => {
    const pageId = newId();
    const revisionId = newId();
    await prisma.revisions.createMany({
      data: [
        { id: revisionId, pageId, body: `body of ${path}`, format: 'markdown' },
      ],
    });
    return Page.create({
      _id: pageId,
      path,
      parent,
      grant: PageGrant.GRANT_PUBLIC,
      revision: revisionId,
      descendantCount,
    });
  };

  /**
   * base
   * ├── src (the source) ── a ── a/b
   * │                     └ c
   * └── other
   */
  const seed = async (name: string) => {
    const basePath = `${PATH_ROOT}/${name}`;
    const base = await createPageWithRevision(basePath, rootId, 5);
    const srcPath = `${basePath}/src`;
    const src = await createPageWithRevision(srcPath, base._id, 3);
    const a = await createPageWithRevision(`${srcPath}/a`, src._id, 1);
    await createPageWithRevision(`${srcPath}/a/b`, a._id);
    await createPageWithRevision(`${srcPath}/c`, src._id);
    const other = await createPageWithRevision(`${basePath}/other`, base._id);
    return {
      basePath,
      base,
      srcPath,
      src,
      other,
      newPagePath: `${basePath}/copy`,
      descendantSuffixes: ['/a', '/a/b', '/c'],
    };
  };

  const postDuplicate = (pageId: Types.ObjectId, pageNameInput: string) =>
    request(app)
      .post('/duplicate')
      .send({
        pageId: pageId.toString(),
        pageNameInput,
        isRecursively: true,
        onlyDuplicateUserRelatedResources: false,
      })
      .timeout({ deadline: 3_000 });

  const putRename = (
    page: HydratedDocument<PageDocument>,
    newPagePath: string,
  ) =>
    request(app)
      .put('/rename')
      .send({
        pageId: page._id.toString(),
        revisionId: String(page.revision),
        newPagePath,
        isRecursively: true,
      })
      .timeout({ deadline: 3_000 });

  const expectRefusedAsInProgress = (response: request.Response): void => {
    expect(response.status).toBe(409);
    expect(response.body.errors).toEqual([
      expect.objectContaining({ code: 'operation_in_progress' }),
    ]);
  };

  const waitUntilNoPageOperation = () =>
    vi.waitFor(
      async () => {
        expect(await PageOperation.countDocuments({})).toBe(0);
      },
      { timeout: 4000, interval: 50 },
    );

  /**
   * Holds the first normalizeParentRecursively call for `toPath` until the
   * test resumes or fails it; every other call runs as is (the recovery's own
   * sub operation included).
   */
  const holdDescendantRunOf = (toPath: string) => {
    const pageService = crowi.pageService;
    const original = pageService.normalizeParentRecursively.bind(pageService);
    const entered = createDeferred();
    const gate = createDeferred();
    let heldCall: Promise<number> | undefined;
    const spy = vi
      .spyOn(pageService, 'normalizeParentRecursively')
      .mockImplementation((...args) => {
        if (heldCall == null && args[0].includes(toPath)) {
          heldCall = (async () => {
            entered.resolve();
            await gate.promise;
            return original(...args);
          })();
          return heldCall;
        }
        return original(...args);
      });
    return {
      entered: entered.promise,
      resume: (): void => gate.resolve(),
      fail: (err: Error): void => gate.reject(err),
      /** Settles once the held call has ended, whichever way it ended. */
      settled: async (): Promise<void> => {
        await heldCall?.catch(() => undefined);
      },
      restore: (): void => spy.mockRestore(),
    };
  };

  const expireDuplicateOperation = async (fromPath: string): Promise<void> => {
    const { modifiedCount } = await PageOperation.updateOne(
      { actionType: PageActionType.Duplicate, fromPath },
      {
        $set: {
          lastProgressAt: new Date(Date.now() - STALL_THRESHOLD_MS - 1000),
        },
      },
    );
    expect(modifiedCount).toBe(1);
  };

  const createRecoveryCron = () =>
    new InterruptedDuplicateRecoveryCronService({
      duplicateDeps: crowi.pageService.duplicateDeps(),
      appService: crowi.appService,
      waitBeforeRun: async () => {},
    });

  const findDescendantCopies = (newPagePath: string) =>
    Page.find({
      path: { $regex: `^${escapeStringForMongoRegex(`${newPagePath}/`)}` },
    }).lean();

  /** Every copy has the page one level up as its parent; the copy's top page has base. */
  const expectCopyOnTree = async (
    seeded: Awaited<ReturnType<typeof seed>>,
  ): Promise<void> => {
    const top = await Page.findOne({ path: seeded.newPagePath }).lean();
    expect(top?.parent?.toString()).toBe(seeded.base._id.toString());
    const copies = await findDescendantCopies(seeded.newPagePath);
    expect(copies.map((p) => p.path).sort()).toEqual(
      seeded.descendantSuffixes.map((s) => `${seeded.newPagePath}${s}`).sort(),
    );
    const idByPath = new Map(
      [top, ...copies].map((p) => [p?.path, String(p?._id)]),
    );
    for (const copy of copies) {
      const parentPath = copy.path.slice(0, copy.path.lastIndexOf('/'));
      expect(String(copy.parent)).toBe(idByPath.get(parentPath));
    }
    expect(top?.descendantCount).toBe(seeded.descendantSuffixes.length);
    // base: src subtree (4) + copy subtree (4) + other (1)
    expect((await Page.findById(seeded.base._id).lean())?.descendantCount).toBe(
      9,
    );
  };

  /**
   * Who was told that the duplicate was interrupted, and how many times. A
   * repeated notice with the same content is folded into one InAppNotification
   * document, so the activities behind it are counted too.
   */
  const interruptedNoticesFor = async (copyTopId: string) => {
    await vi.waitFor(
      async () => {
        expect(
          await InAppNotification.exists({
            target: copyTopId,
            action: INTERRUPTED,
          }),
        ).not.toBeNull();
      },
      { timeout: 4000, interval: 50 },
    );
    // give a wrongly repeated or misdirected notice time to land
    await new Promise((resolve) => setTimeout(resolve, 300));
    const notifications = await InAppNotification.find({
      target: copyTopId,
      action: INTERRUPTED,
    }).lean();
    return {
      recipients: notifications.map((n) => String(n.user)),
      deliveredActivityCount: notifications.reduce(
        (sum, n) => sum + n.activities.length,
        0,
      ),
      activityCount: await prisma.activities.count({
        where: { target: copyTopId, action: INTERRUPTED },
      }),
    };
  };

  const expectNotifiedOnceToRequesterOnly = async (
    copyTopId: string,
  ): Promise<void> => {
    expect(await interruptedNoticesFor(copyTopId)).toEqual({
      recipients: [requester._id.toString()],
      deliveredActivityCount: 1,
      activityCount: 1,
    });
  };

  const removeFixtures = async (): Promise<void> => {
    const fixturePageIds = (
      await Page.find({ path: fixturePathPattern }, { _id: 1 })
    ).map((page) => page._id.toString());
    await PageOperation.deleteMany({});
    await Subscription.deleteMany({ user: { $in: createdUserIds } });
    await InAppNotification.deleteMany({ user: { $in: createdUserIds } });
    await prisma.activities.deleteMany({
      where: {
        OR: [
          { userId: { in: createdUserIds } },
          { target: { in: fixturePageIds } },
        ],
      },
    });
    await prisma.revisions.deleteMany({
      where: { pageId: { in: fixturePageIds } },
    });
    await Page.deleteMany({ path: fixturePathPattern });
    // The recovery recounts every ancestor of the copy, the shared root included.
    await Page.updateOne(
      { _id: rootId },
      { $set: { descendantCount: rootDescendantCount } },
    );
  };

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');

    isV5CompatibleInDbBefore = crowi.configManager.getConfig(
      'app:isV5Compatible',
      ConfigSource.db,
    );
    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    await mongoose.model('User').deleteMany({
      username: { $regex: `^${USERNAME_PREFIX}` },
    });
    requester = await createUser('requester');
    otherUser = await createUser('other');

    const root =
      (await Page.findOne({ path: '/' })) ??
      (await Page.create({ path: '/', grant: PageGrant.GRANT_PUBLIC }));
    rootId = root._id;
    rootDescendantCount = root.descendantCount ?? 0;

    await crowi.setUpGlobalNotification();
    vi.spyOn(crowi.globalNotificationService, 'fire').mockResolvedValue(
      undefined,
    );

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

    const { setup } = await import('./index');
    app.use('/', setup(crowi));

    await Page.deleteMany({ path: fixturePathPattern });
  }, 120_000);

  // canOperate and the recovery take-over look at every PageOperation, so
  // leftovers from other files in this worker's database must not be visible.
  beforeEach(async () => {
    await PageOperation.deleteMany({});
  });

  afterEach(async () => {
    await removeFixtures();
  });

  afterAll(async () => {
    try {
      await removeFixtures();
      await mongoose.model('User').deleteMany({ _id: { $in: createdUserIds } });
    } finally {
      await crowi.configManager.updateConfigs(
        { 'app:isV5Compatible': isV5CompatibleInDbBefore },
        { removeIfUndefined: true },
      );
      vi.restoreAllMocks();
    }
  });

  it('refuses an overlapping duplicate, rename and move while the descendants are copied, and accepts them once done (Req 3.1, 3.2)', async () => {
    const seeded = await seed('in-progress');
    const copyAgainPath = `${seeded.basePath}/copy-again`;
    const renamedPath = `${seeded.basePath}/src-renamed`;
    const movedPath = `${seeded.newPagePath}/moved`;
    const hold = holdDescendantRunOf(seeded.newPagePath);

    let copyTopId: string;
    try {
      const started = await postDuplicate(seeded.src._id, seeded.newPagePath);
      expect(started.status).toBe(200);
      copyTopId = String(started.body.page._id);
      await hold.entered;
      // only the duplicate's own PageOperation is left to refuse with
      await vi.waitFor(
        async () => {
          expect(
            (await PageOperation.find({}).lean()).map((op) => op.actionType),
          ).toEqual([PageActionType.Duplicate]);
        },
        { timeout: 4000, interval: 50 },
      );

      expectRefusedAsInProgress(
        await postDuplicate(seeded.src._id, copyAgainPath),
      );
      expectRefusedAsInProgress(await putRename(seeded.src, renamedPath));
      expectRefusedAsInProgress(await putRename(seeded.other, movedPath));

      expect(await Page.exists({ path: copyAgainPath })).toBeNull();
      expect(await Page.exists({ path: renamedPath })).toBeNull();
      expect(await Page.exists({ path: movedPath })).toBeNull();
      expect((await Page.findById(seeded.src._id))?.path).toBe(seeded.srcPath);
      expect((await Page.findById(seeded.other._id))?.path).toBe(
        `${seeded.basePath}/other`,
      );
    } finally {
      hold.resume();
      await hold.settled();
      hold.restore();
    }
    await waitUntilNoPageOperation();
    // completed by the run itself, not by a recovery
    await expectCopyOnTree(seeded);
    expect(
      await prisma.activities.count({
        where: { target: copyTopId, action: INTERRUPTED },
      }),
    ).toBe(0);

    expect((await postDuplicate(seeded.src._id, copyAgainPath)).status).toBe(
      200,
    );
    await waitUntilNoPageOperation();
    expect((await putRename(seeded.src, renamedPath)).status).toBe(200);
    await waitUntilNoPageOperation();
    expect((await putRename(seeded.other, movedPath)).status).toBe(200);
    await waitUntilNoPageOperation();
    expect((await Page.findById(seeded.other._id))?.path).toBe(movedPath);
  });

  it('answers as usual when the descendant run fails, then leaves the partial copy on the tree and tells only the duplicating user (Req 4.1, 5.1, 5.5)', async () => {
    const seeded = await seed('failure');
    const hold = holdDescendantRunOf(seeded.newPagePath);

    let response: request.Response;
    try {
      response = await postDuplicate(seeded.src._id, seeded.newPagePath);
      expect(response.status).toBe(200);
      await hold.entered;
      // The default notice would reach every active subscriber of the copy.
      await Subscription.subscribeByPageId(
        new Types.ObjectId(String(otherUser._id)),
        new Types.ObjectId(String(response.body.page._id)),
        SubscriptionStatusType.SUBSCRIBE,
      );
      // the copied descendants are not on the tree yet
      const orphans = await findDescendantCopies(seeded.newPagePath);
      expect(orphans).toHaveLength(seeded.descendantSuffixes.length);
      expect(orphans.every((p) => p.parent == null)).toBe(true);

      hold.fail(new Error('injected failure of the descendant run'));
      await hold.settled();
    } finally {
      hold.restore();
    }

    expect(response.body.page.path).toBe(seeded.newPagePath);
    const copyTopId = String(response.body.page._id);
    expect(
      String((await Page.findOne({ path: seeded.newPagePath }))?._id),
    ).toBe(copyTopId);

    await waitUntilNoPageOperation();
    await expectCopyOnTree(seeded);
    await expectNotifiedOnceToRequesterOnly(copyTopId);
    expect(
      await InAppNotification.countDocuments({ user: otherUser._id }),
    ).toBe(0);
  });

  it('recovers a stalled duplicate in one cron run, after which the overlapping operations are accepted (Req 4.2, 3.3, 5.1)', async () => {
    const seeded = await seed('stalled');
    const hold = holdDescendantRunOf(seeded.newPagePath);

    let copyTopId: string;
    try {
      const started = await postDuplicate(seeded.src._id, seeded.newPagePath);
      expect(started.status).toBe(200);
      copyTopId = String(started.body.page._id);
      await hold.entered;
      await expireDuplicateOperation(seeded.srcPath);

      await createRecoveryCron().executeJob();

      expect(await PageOperation.countDocuments({})).toBe(0);
      await expectCopyOnTree(seeded);
    } finally {
      // The stalled run wakes up after the take-over and must write nothing more.
      hold.resume();
      await hold.settled();
      hold.restore();
    }
    await expectNotifiedOnceToRequesterOnly(copyTopId);
    // the woken run added nothing to the recounted ancestors
    await expectCopyOnTree(seeded);

    const copyAgainPath = `${seeded.basePath}/copy-again`;
    expect((await postDuplicate(seeded.src._id, copyAgainPath)).status).toBe(
      200,
    );
    await waitUntilNoPageOperation();
    expect(
      (await putRename(seeded.src, `${seeded.basePath}/src-renamed`)).status,
    ).toBe(200);
    await waitUntilNoPageOperation();
    expect(
      (await putRename(seeded.other, `${seeded.newPagePath}/moved`)).status,
    ).toBe(200);
    await waitUntilNoPageOperation();
  });

  it('notifies once when two recoveries take on the same stalled duplicate at once (Req 4.7)', async () => {
    const seeded = await seed('concurrent');
    const hold = holdDescendantRunOf(seeded.newPagePath);

    let copyTopId: string;
    try {
      const started = await postDuplicate(seeded.src._id, seeded.newPagePath);
      expect(started.status).toBe(200);
      copyTopId = String(started.body.page._id);
      await hold.entered;
      await expireDuplicateOperation(seeded.srcPath);

      await expect(
        Promise.all([
          createRecoveryCron().executeJob(),
          createRecoveryCron().executeJob(),
        ]),
      ).resolves.toEqual([undefined, undefined]);

      expect(await PageOperation.countDocuments({})).toBe(0);
      await expectCopyOnTree(seeded);
    } finally {
      hold.resume();
      await hold.settled();
      hold.restore();
    }
    await expectNotifiedOnceToRequesterOnly(copyTopId);
  });
});
