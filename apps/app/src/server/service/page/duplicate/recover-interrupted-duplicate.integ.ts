import { type IUserHasId, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose, { type Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import { PageActionType } from '~/interfaces/page-operation';
import { pageDuplicateInterruptedSnapshot } from '~/models/serializers/in-app-notification-snapshot/page-duplicate-interrupted';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument, PageModel } from '~/server/models/page';
import PageOperation from '~/server/models/page-operation';
import { prisma } from '~/utils/prisma';

import {
  createDuplicatePageOperation,
  deleteDuplicatePageOperation,
  type OwnedDuplicatePageOperation,
  OwnershipLostError,
  STALL_THRESHOLD_MS,
  takeOverStalledDuplicate,
} from './duplicate-page-operation';
import type { DuplicateDeps, DuplicatePagePort } from './duplicate-page-port';
import {
  type InterruptedDuplicate,
  recoverInterruptedDuplicate,
  toInterruptedDuplicate,
} from './recover-interrupted-duplicate';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PATH_ROOT = `/recover-interrupted-duplicate-integ-${WORKER_ID}`;
const USERNAME_PREFIX = `recoverInterruptedDuplicateInteg${WORKER_ID}`;

// A moment at which every PageOperation that reported progress just now is
// judged expired, i.e. what another process's cron would see later.
const afterStall = (): Date => new Date(Date.now() + STALL_THRESHOLD_MS + 1000);

describe('recoverInterruptedDuplicate', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let deps: DuplicateDeps;
  let owner: HydratedDocument<IUserHasId>;
  let rootId: Types.ObjectId;
  const createdUserIds: string[] = [];

  const findByPath = (path: string) => Page.findOne({ path }).lean();

  const createUser = async (): Promise<HydratedDocument<IUserHasId>> => {
    const username = `${USERNAME_PREFIX}u${createdUserIds.length + 1}`;
    const user = await mongoose.model<IUserHasId>('User').create({
      name: username,
      username,
      email: `${username}@example.com`,
      status: 2,
    });
    createdUserIds.push(String(user._id));
    return user;
  };

  // Tree (A is on the tree and its count is stale; the copy pages are orphans
  // as copyDescendantBatch leaves them):
  //   A/src (source top), A/src/x, A/src/y   -- on the tree
  //   A/dest                                 -- on the tree
  //   A/dest/copy, A/dest/copy/x             -- orphan copy; src/y was never copied
  const seedCase = async (name: string, userId: string) => {
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
      descendantCount: 2,
    });
    await Page.create({ path: `${srcPath}/x`, parent: src._id });
    await Page.create({ path: `${srcPath}/y`, parent: src._id });
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
      userId,
      fromPath: srcPath,
      toPath,
    });
    return { aPath, srcPath, destPath, toPath, dest, copyTop, operation };
  };

  type SeededCase = Awaited<ReturnType<typeof seedCase>>;

  const errorTarget = (
    seeded: SeededCase,
    userId: string,
    overrides: Partial<InterruptedDuplicate> = {},
  ): InterruptedDuplicate => ({
    operation: seeded.operation,
    fromPath: seeded.srcPath,
    toPath: seeded.toPath,
    userId,
    shouldNormalizeParent: true,
    sourcePageCount: 3,
    cause: { kind: 'error', error: new Error('batch failed') },
    ...overrides,
  });

  // The cron path: the run stops reporting progress, another process takes over.
  const stalledTarget = async (): Promise<InterruptedDuplicate> => {
    const stalled = await takeOverStalledDuplicate(afterStall());
    if (stalled == null) {
      throw new Error('expected a stalled PageOperation to take over');
    }
    return toInterruptedDuplicate(stalled);
  };

  const takeOverByAnotherProcess = async (): Promise<void> => {
    expect(await takeOverStalledDuplicate(afterStall())).not.toBeNull();
  };

  const operationExists = async (
    operation: OwnedDuplicatePageOperation,
  ): Promise<boolean> =>
    (await PageOperation.exists({ _id: operation.operationId })) != null;

  // createActivity is awaited before the notification event is emitted, so the
  // absence of the activity proves no notification was issued.
  const countInterruptedActivities = (copyTopId: Types.ObjectId) =>
    prisma.activities.count({
      where: {
        action: SupportedAction.ACTION_PAGE_DUPLICATE_INTERRUPTED,
        target: copyTopId.toString(),
      },
    });

  // The in-app notification listener is async and emit() does not wait for it.
  const waitForNotification = async (
    copyTopId: Types.ObjectId,
  ): Promise<void> => {
    for (let i = 0; i < 100; i++) {
      // biome-ignore lint/performance/noAwaitInLoops: polling
      const count = await InAppNotification.countDocuments({
        target: copyTopId,
      });
      if (count > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  const expectNoNotification = async (
    copyTopId: Types.ObjectId,
  ): Promise<void> => {
    expect(await countInterruptedActivities(copyTopId)).toBe(0);
    // give a wrongly issued notification time to land
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await InAppNotification.countDocuments({ target: copyTopId })).toBe(
      0,
    );
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
    owner = await createUser();
    const root =
      (await Page.findOne({ path: '/' })) ??
      (await Page.create({ path: '/', grant: PageGrant.GRANT_PUBLIC }));
    rootId = root._id;
  }, 60_000);

  // takeOverStalledDuplicate looks at every duplicate PageOperation, so leftovers
  // from other files in this worker's database must not be visible to it.
  beforeEach(async () => {
    await PageOperation.deleteMany({ actionType: PageActionType.Duplicate });
  });

  afterAll(async () => {
    await PageOperation.deleteMany({ actionType: PageActionType.Duplicate });
    const userIds = createdUserIds;
    await InAppNotification.deleteMany({ user: { $in: userIds } });
    await prisma.activities.deleteMany({
      where: { userId: { in: userIds } },
    });
    await Page.deleteMany({ path: { $regex: `^${PATH_ROOT}` } });
    await mongoose.model('User').deleteMany({ _id: { $in: userIds } });
  });

  describe.each([
    {
      cause: 'error' as const,
      target: async (seeded: SeededCase, userId: string) =>
        errorTarget(seeded, userId),
    },
    {
      cause: 'stalled' as const,
      target: () => stalledTarget(),
    },
  ])('when the duplicate stopped by $cause', ({ cause, target }) => {
    it('attaches the copy to the page tree and makes the counts real (Req 4.5)', async () => {
      const seeded = await seedCase(`${cause}-tree`, String(owner._id));

      const outcome = await recoverInterruptedDuplicate(
        deps,
        await target(seeded, String(owner._id)),
      );

      expect(outcome).toEqual({ status: 'recovered', copiedPageCount: 2 });
      const top = await findByPath(seeded.toPath);
      const x = await findByPath(`${seeded.toPath}/x`);
      expect(top?.parent?.toString()).toBe(seeded.dest._id.toString());
      expect(x?.parent?.toString()).toBe(top?._id.toString());
      expect(top?.descendantCount).toBe(1);
      expect((await findByPath(seeded.destPath))?.descendantCount).toBe(2);
      // A holds src, src/x, src/y, dest, copy and copy/x
      expect((await findByPath(seeded.aPath))?.descendantCount).toBe(6);
    });

    it('removes the PageOperation so the duplicate is never recovered again (Req 3.3, 4.7)', async () => {
      const seeded = await seedCase(`${cause}-op`, String(owner._id));
      const recoveryTarget = await target(seeded, String(owner._id));

      await recoverInterruptedDuplicate(deps, recoveryTarget);

      expect(await operationExists(seeded.operation)).toBe(false);
      await expect(
        deleteDuplicatePageOperation(recoveryTarget.operation),
      ).rejects.toBeInstanceOf(OwnershipLostError);
      expect(await takeOverStalledDuplicate(afterStall())).toBeNull();
    });

    it('notifies the duplicating user once, with paths and counts (Req 4.1)', async () => {
      const seeded = await seedCase(`${cause}-notify`, String(owner._id));

      await recoverInterruptedDuplicate(
        deps,
        await target(seeded, String(owner._id)),
      );
      await waitForNotification(seeded.copyTop._id);
      await new Promise((resolve) => setTimeout(resolve, 300));

      const notifications = await InAppNotification.find({
        target: seeded.copyTop._id,
      }).lean();
      expect(notifications).toHaveLength(1);
      expect(String(notifications[0].user)).toBe(String(owner._id));
      expect(
        pageDuplicateInterruptedSnapshot.parse(notifications[0].snapshot),
      ).toEqual({
        path: seeded.toPath,
        fromPath: seeded.srcPath,
        toPath: seeded.toPath,
        copiedPageCount: 2,
        sourcePageCount: 3,
      });
    });

    it('keeps the partial copy and does not copy the rest (Req 4.1, 4.6)', async () => {
      const seeded = await seedCase(`${cause}-keep`, String(owner._id));

      await recoverInterruptedDuplicate(
        deps,
        await target(seeded, String(owner._id)),
      );

      expect(await findByPath(seeded.toPath)).not.toBeNull();
      expect(await findByPath(`${seeded.toPath}/x`)).not.toBeNull();
      expect(await findByPath(`${seeded.toPath}/y`)).toBeNull();
    });
  });

  describe('when the copy top page does not exist', () => {
    it('only removes the PageOperation and does not notify', async () => {
      const seeded = await seedCase('copy-missing', String(owner._id));
      await Page.deleteMany({
        path: { $in: [seeded.toPath, `${seeded.toPath}/x`] },
      });

      const outcome = await recoverInterruptedDuplicate(
        deps,
        errorTarget(seeded, String(owner._id)),
      );

      expect(outcome).toEqual({ status: 'copy-missing' });
      expect(await operationExists(seeded.operation)).toBe(false);
      expect(await findByPath(seeded.toPath)).toBeNull();
      await expectNoNotification(seeded.copyTop._id);
    });

    it('leaves the PageOperation to the process that took it over', async () => {
      const seeded = await seedCase('copy-missing-lost', String(owner._id));
      await Page.deleteMany({
        path: { $in: [seeded.toPath, `${seeded.toPath}/x`] },
      });
      await takeOverByAnotherProcess();

      const outcome = await recoverInterruptedDuplicate(
        deps,
        errorTarget(seeded, String(owner._id)),
      );

      expect(outcome).toEqual({ status: 'ownership-lost' });
      expect(await operationExists(seeded.operation)).toBe(true);
    });
  });

  describe('when the duplicating user is gone', () => {
    it.each([
      {
        label: 'deleted by an admin',
        userId: async () => {
          const user = await createUser();
          // GROWI deletes a user by marking it, the document stays
          const doc = await mongoose.model('User').findById(user._id);
          await doc.statusDelete();
          return String(user._id);
        },
      },
      {
        label: 'not in the database',
        userId: async () => new mongoose.Types.ObjectId().toString(),
      },
    ])('recovers the copy but notifies nobody ($label)', async ({
      label,
      userId,
    }) => {
      const id = await userId();
      const seeded = await seedCase(`no-user-${label.split(' ')[0]}`, id);

      const outcome = await recoverInterruptedDuplicate(
        deps,
        errorTarget(seeded, id),
      );

      expect(outcome).toEqual({ status: 'recovered', copiedPageCount: 2 });
      expect((await findByPath(seeded.toPath))?.parent?.toString()).toBe(
        seeded.dest._id.toString(),
      );
      expect(await operationExists(seeded.operation)).toBe(false);
      await expectNoNotification(seeded.copyTop._id);
    });
  });

  describe('when another process takes the recovery over', () => {
    it('stops before the sub operation when taken over beforehand', async () => {
      const seeded = await seedCase('lost-before', String(owner._id));
      await takeOverByAnotherProcess();

      const outcome = await recoverInterruptedDuplicate(
        deps,
        errorTarget(seeded, String(owner._id)),
      );

      expect(outcome).toEqual({ status: 'ownership-lost' });
      expect((await findByPath(seeded.toPath))?.parent).toBeNull();
      expect(await operationExists(seeded.operation)).toBe(true);
      await expectNoNotification(seeded.copyTop._id);
    });

    it('stops without deleting or notifying when taken over during the sub operation', async () => {
      const seeded = await seedCase('lost-during', String(owner._id));
      const pageService = pageServiceWith({
        updateDescendantCountOfSelfAndDescendants: async (...args) => {
          await takeOverByAnotherProcess();
          return crowi.pageService.updateDescendantCountOfSelfAndDescendants(
            ...args,
          );
        },
      });

      const outcome = await recoverInterruptedDuplicate(
        { ...deps, pageService },
        errorTarget(seeded, String(owner._id)),
      );

      expect(outcome).toEqual({ status: 'ownership-lost' });
      expect((await findByPath(seeded.destPath))?.descendantCount).toBe(0);
      expect(await operationExists(seeded.operation)).toBe(true);
      await expectNoNotification(seeded.copyTop._id);
    });

    it('does not notify when the PageOperation can no longer be deleted (notification follows deletion)', async () => {
      const seeded = await seedCase('lost-at-delete', String(owner._id));
      // The ancestor recount is the last step that reports progress, so a
      // take-over right after it lets the sub operation finish and only the
      // deletion fail.
      const pageService = pageServiceWith({
        updateDescendantCountOfPagesWithPaths: async (...args) => {
          await crowi.pageService.updateDescendantCountOfPagesWithPaths(
            ...args,
          );
          await takeOverByAnotherProcess();
        },
      });

      const outcome = await recoverInterruptedDuplicate(
        { ...deps, pageService },
        errorTarget(seeded, String(owner._id)),
      );

      expect(outcome).toEqual({ status: 'ownership-lost' });
      expect((await findByPath(seeded.toPath))?.parent?.toString()).toBe(
        seeded.dest._id.toString(),
      );
      expect(await operationExists(seeded.operation)).toBe(true);
      await expectNoNotification(seeded.copyTop._id);
    });
  });

  it('passes other sub operation errors to the caller and keeps the PageOperation for a later recovery', async () => {
    const seeded = await seedCase('sub-op-error', String(owner._id));
    const failure = new Error('database unavailable');
    const pageService = pageServiceWith({
      updateDescendantCountOfSelfAndDescendants: () => Promise.reject(failure),
    });

    await expect(
      recoverInterruptedDuplicate(
        { ...deps, pageService },
        errorTarget(seeded, String(owner._id)),
      ),
    ).rejects.toBe(failure);

    expect(await operationExists(seeded.operation)).toBe(true);
    await expectNoNotification(seeded.copyTop._id);
  });
});
