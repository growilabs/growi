import { type IUserHasId, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose, { type Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { PageActionStage, PageActionType } from '~/interfaces/page-operation';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument, PageModel } from '~/server/models/page';
import PageOperation from '~/server/models/page-operation';
import { prisma } from '~/utils/prisma';

import {
  createDuplicatePageOperation,
  type OwnedDuplicatePageOperation,
  STALL_THRESHOLD_MS,
} from './duplicate-page-operation';
import type { DuplicateDeps, DuplicatePagePort } from './duplicate-page-port';
import { InterruptedDuplicateRecoveryCronService } from './interrupted-duplicate-recovery-cron';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PATH_ROOT = `/interrupted-duplicate-recovery-cron-integ-${WORKER_ID}`;
const USERNAME_PREFIX = `interruptedDuplicateRecoveryCronInteg${WORKER_ID}`;

const noWait = async (): Promise<void> => {};

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

describe('InterruptedDuplicateRecoveryCronService', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let deps: DuplicateDeps;
  let owner: HydratedDocument<IUserHasId>;
  let rootId: Types.ObjectId;
  const createdUserIds: string[] = [];

  const findByPath = (path: string) => Page.findOne({ path }).lean();

  const createCron = (
    overrides: Partial<DuplicateDeps> = {},
    waitBeforeRun: () => Promise<void> = noWait,
  ) =>
    new InterruptedDuplicateRecoveryCronService({
      duplicateDeps: { ...deps, ...overrides },
      appService: crowi.appService,
      waitBeforeRun,
    });

  // What the duplicating process leaves behind when it stops: the copy pages
  // are orphans and the PageOperation no longer reports progress.
  //   A/src (source top), A/src/x -- on the tree
  //   A/dest                      -- on the tree
  //   A/dest/copy, A/dest/copy/x  -- orphan copy
  const seedCase = async (name: string) => {
    const aPath = `${PATH_ROOT}/${name}`;
    const srcPath = `${aPath}/src`;
    const destPath = `${aPath}/dest`;
    const toPath = `${destPath}/copy`;
    const a = await Page.create({
      path: aPath,
      grant: PageGrant.GRANT_PUBLIC,
      parent: rootId,
      descendantCount: 3,
    });
    const src = await Page.create({
      path: srcPath,
      grant: PageGrant.GRANT_PUBLIC,
      parent: a._id,
      descendantCount: 1,
    });
    await Page.create({ path: `${srcPath}/x`, parent: src._id });
    const dest = await Page.create({
      path: destPath,
      grant: PageGrant.GRANT_PUBLIC,
      parent: a._id,
      descendantCount: 0,
    });
    const copyTop = await Page.create({
      path: toPath,
      grant: PageGrant.GRANT_PUBLIC,
    });
    await Page.create({ path: `${toPath}/x`, grant: PageGrant.GRANT_PUBLIC });

    const operation = await createDuplicatePageOperation({
      page: src,
      userId: String(owner._id),
      fromPath: srcPath,
      toPath,
    });
    return { toPath, dest, copyTop, operation };
  };

  // The last progress report is older than the stall threshold.
  const expire = async (
    operation: OwnedDuplicatePageOperation,
  ): Promise<void> => {
    await PageOperation.updateOne(
      { _id: operation.operationId },
      {
        $set: {
          lastProgressAt: new Date(Date.now() - STALL_THRESHOLD_MS - 1000),
        },
      },
    );
  };

  const operationExists = async (
    operation: OwnedDuplicatePageOperation,
  ): Promise<boolean> =>
    (await PageOperation.exists({ _id: operation.operationId })) != null;

  const isAttached = async (seeded: {
    toPath: string;
    dest: { _id: Types.ObjectId };
  }) =>
    (await findByPath(seeded.toPath))?.parent?.toString() ===
    seeded.dest._id.toString();

  // The in-app notification listener is async and emit() does not wait for it.
  const countNotificationsEventually = async (
    copyTopId: Types.ObjectId,
  ): Promise<number> => {
    for (let i = 0; i < 100; i++) {
      // biome-ignore lint/performance/noAwaitInLoops: polling
      const count = await InAppNotification.countDocuments({
        target: copyTopId,
      });
      if (count > 0) {
        // give a wrongly duplicated notification time to land
        await new Promise((resolve) => setTimeout(resolve, 300));
        return InAppNotification.countDocuments({ target: copyTopId });
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return 0;
  };

  const pageServiceWith = (
    overrides: Partial<DuplicatePagePort>,
  ): DuplicatePagePort => {
    const ps = crowi.pageService;
    return {
      create: (...args) => ps.create(...args),
      getParentAndFillAncestorsByUser: (...args) =>
        ps.getParentAndFillAncestorsByUser(...args),
      normalizeParentRecursively: (...args) =>
        ps.normalizeParentRecursively(...args),
      updateDescendantCountOfSelfAndDescendants: (...args) =>
        ps.updateDescendantCountOfSelfAndDescendants(...args),
      updateDescendantCountOfPagesWithPaths: (...args) =>
        ps.updateDescendantCountOfPagesWithPaths(...args),
      updateDescendantCountOfAncestors: (...args) =>
        ps.updateDescendantCountOfAncestors(...args),
      ...overrides,
    };
  };

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    const { activityService } = crowi;
    if (activityService == null) {
      throw new Error('activityService is not initialized');
    }
    deps = {
      pageService: crowi.pageService,
      pageGrantService: crowi.pageGrantService,
      pageOperationService: crowi.pageOperationService,
      activityService,
      pageEvent: crowi.events.page,
      tagEvent: crowi.events.tag,
      activityEvent: crowi.events.activity,
    };
    await Page.deleteMany({ path: { $regex: `^${PATH_ROOT}` } });
    const username = `${USERNAME_PREFIX}u1`;
    owner = await mongoose.model<IUserHasId>('User').create({
      name: username,
      username,
      email: `${username}@example.com`,
      status: 2,
    });
    createdUserIds.push(String(owner._id));
    const root =
      (await Page.findOne({ path: '/' })) ??
      (await Page.create({ path: '/', grant: PageGrant.GRANT_PUBLIC }));
    rootId = root._id;
  }, 60_000);

  // The take-over looks at every duplicate PageOperation, so leftovers from
  // other files in this worker's database must not be visible to it.
  beforeEach(async () => {
    await PageOperation.deleteMany({ actionType: PageActionType.Duplicate });
  });

  afterAll(async () => {
    await PageOperation.deleteMany({ actionType: PageActionType.Duplicate });
    await InAppNotification.deleteMany({ user: { $in: createdUserIds } });
    await prisma.activities.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await Page.deleteMany({ path: { $regex: `^${PATH_ROOT}` } });
    await mongoose.model('User').deleteMany({ _id: { $in: createdUserIds } });
  });

  it('recovers an expired duplicate in one run (Req 4.2)', async () => {
    const seeded = await seedCase('one');
    await expire(seeded.operation);

    await createCron().executeJob();

    expect(await isAttached(seeded)).toBe(true);
    expect(await operationExists(seeded.operation)).toBe(false);
    expect(await countNotificationsEventually(seeded.copyTop._id)).toBe(1);
  });

  it('recovers every expired duplicate in one run (Req 4.2)', async () => {
    const first = await seedCase('many-1');
    const second = await seedCase('many-2');
    await expire(first.operation);
    await expire(second.operation);

    await createCron().executeJob();

    expect(await isAttached(first)).toBe(true);
    expect(await isAttached(second)).toBe(true);
    expect(await operationExists(first.operation)).toBe(false);
    expect(await operationExists(second.operation)).toBe(false);
  });

  it('leaves a duplicate that still reports progress alone (Req 4.4)', async () => {
    const seeded = await seedCase('running');

    await createCron().executeJob();

    expect(await isAttached(seeded)).toBe(false);
    expect(await operationExists(seeded.operation)).toBe(true);
  });

  it('waits before taking over, so processes do not start at once', async () => {
    const seeded = await seedCase('jitter');
    await expire(seeded.operation);
    const wait = createDeferred();

    const run = createCron({}, () => wait.promise).executeJob();
    // let the run proceed as far as it can without the wait ending
    await new Promise((resolve) => setTimeout(resolve, 300));
    const ownerWhileWaiting = (
      await PageOperation.findById(seeded.operation.operationId).lean()
    )?.ownerToken;
    wait.resolve();
    await run;

    // not even taken over while waiting
    expect(ownerWhileWaiting).toBe(seeded.operation.ownerToken);
    expect(await isAttached(seeded)).toBe(true);
  });

  it('a hung recovery does not keep the next run from recovering other duplicates (Req 4.2)', async () => {
    const hung = await seedCase('hung');
    await expire(hung.operation);
    const hang = createDeferred();
    const entered = createDeferred();
    const cron = createCron({
      pageService: pageServiceWith({
        updateDescendantCountOfSelfAndDescendants: (path, onBatchStart) => {
          if (path === hung.toPath) {
            entered.resolve();
            return hang.promise;
          }
          return crowi.pageService.updateDescendantCountOfSelfAndDescendants(
            path,
            onBatchStart,
          );
        },
      }),
    });

    const hungRun = cron.executeJob();
    try {
      await entered.promise;
      const other = await seedCase('after-hung');
      await expire(other.operation);

      await cron.executeJob();

      expect(await isAttached(other)).toBe(true);
      expect(await operationExists(other.operation)).toBe(false);
      expect(await operationExists(hung.operation)).toBe(true);
    } finally {
      hang.reject(new Error('released by the test'));
      await hungRun;
    }
  });

  it('stamps each take-over with the time it happens, not the start of the run (Req 4.4)', async () => {
    // Otherwise a take-over late in a long run writes an already-expired
    // lastProgressAt, and an overlapping run takes the record over again.
    const slow = await seedCase('slow');
    await expire(slow.operation);
    const gate = createDeferred();
    const entered = createDeferred();
    let next: Awaited<ReturnType<typeof seedCase>> | undefined;
    // lastProgressAt of the next record as its recovery starts, i.e. before
    // the recovery itself reports any progress
    let stampedAtTakeOver: Date | undefined;
    const cron = createCron({
      pageService: pageServiceWith({
        normalizeParentRecursively: async (...args) => {
          const [paths] = args;
          if (next != null && paths[0] === next.toPath) {
            stampedAtTakeOver = (
              await PageOperation.findById(next.operation.operationId).lean()
            )?.lastProgressAt;
          }
          return crowi.pageService.normalizeParentRecursively(...args);
        },
        updateDescendantCountOfSelfAndDescendants: async (
          path,
          onBatchStart,
        ) => {
          if (path === slow.toPath) {
            entered.resolve();
            await gate.promise;
          }
          return crowi.pageService.updateDescendantCountOfSelfAndDescendants(
            path,
            onBatchStart,
          );
        },
      }),
    });

    const run = cron.executeJob();
    let insertedAt: Date;
    try {
      await entered.promise;
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Taken over by the same run once the slow recovery has finished.
      next = await seedCase('slow-next');
      await expire(next.operation);
      insertedAt = new Date();
    } finally {
      gate.resolve();
      await run;
    }

    expect(await isAttached(next)).toBe(true);
    expect(stampedAtTakeOver?.getTime()).toBeGreaterThanOrEqual(
      insertedAt.getTime(),
    );
  });

  it('deletes a PageOperation lacking a stored value and still recovers the others in the same run', async () => {
    const seeded = await seedCase('beside-incomplete');
    await expire(seeded.operation);
    // No toPath and no page.descendantCount; the model would not save it.
    const incompleteId = new mongoose.Types.ObjectId();
    await PageOperation.collection.insertOne({
      _id: incompleteId,
      actionType: PageActionType.Duplicate,
      actionStage: PageActionStage.Main,
      page: {
        _id: new mongoose.Types.ObjectId(),
        grant: PageGrant.GRANT_PUBLIC,
      },
      user: { _id: owner._id },
      fromPath: `${PATH_ROOT}/incomplete`,
      ownerToken: 'incomplete-owner',
      lastProgressAt: new Date(Date.now() - STALL_THRESHOLD_MS - 1000),
    });

    await expect(createCron().executeJob()).resolves.toBeUndefined();

    expect(await isAttached(seeded)).toBe(true);
    expect(await operationExists(seeded.operation)).toBe(false);
    expect(await PageOperation.exists({ _id: incompleteId })).toBeNull();
  });

  it('does nothing while GROWI is in maintenance mode', async () => {
    const seeded = await seedCase('maintenance');
    await expire(seeded.operation);
    await crowi.appService.startMaintenanceMode();

    try {
      await createCron().executeJob();
      expect(await isAttached(seeded)).toBe(false);
      expect(await operationExists(seeded.operation)).toBe(true);
    } finally {
      await crowi.appService.endMaintenanceMode();
    }

    await createCron().executeJob();
    expect(await isAttached(seeded)).toBe(true);
  });
});
