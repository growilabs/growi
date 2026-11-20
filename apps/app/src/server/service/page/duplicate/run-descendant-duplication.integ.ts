import { GroupType, type IUserHasId, PageGrant } from '@growi/core';
import { escapeStringForMongoRegex } from '@growi/core/dist/utils';
import type { HydratedDocument } from 'mongoose';
import mongoose, { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import { PageActionType } from '~/interfaces/page-operation';
import { pageDuplicateInterruptedSnapshot } from '~/models/serializers/in-app-notification-snapshot/page-duplicate-interrupted';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument, PageModel } from '~/server/models/page';
import PageOperation from '~/server/models/page-operation';
import UserGroup from '~/server/models/user-group';
import type { IPageGrantService } from '~/server/service/page-grant';
import { prisma } from '~/utils/prisma';

import { BULK_REINDEX_SIZE } from '../consts';
import {
  createDuplicatePageOperation,
  type OwnedDuplicatePageOperation,
  STALL_THRESHOLD_MS,
  takeOverStalledDuplicate,
} from './duplicate-page-operation';
import type { DuplicateDeps, DuplicatePagePort } from './duplicate-page-port';
import {
  type DescendantDuplicationInput,
  runDescendantDuplication,
} from './run-descendant-duplication';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PATH_ROOT = `/run-descendant-duplication-integ-${WORKER_ID}`;
const USERNAME_PREFIX = `runDescendantDuplicationInteg${WORKER_ID}`;

// More than one read batch: a full batch and half of one.
const FLAT_CHILD_COUNT = BULK_REINDEX_SIZE * 1.5;

const newId = (): string => new Types.ObjectId().toHexString();

// A moment at which a PageOperation that reported progress just now is judged
// expired, i.e. what another process's cron would see later.
const afterStall = (): Date => new Date(Date.now() + STALL_THRESHOLD_MS + 1000);

describe('runDescendantDuplication', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let deps: DuplicateDeps;
  let owner: HydratedDocument<IUserHasId>;
  let rootId: Types.ObjectId;
  const createdUserIds: string[] = [];
  const createdGroupIds: string[] = [];

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

  const createPageWithRevision = async (
    path: string,
    parent: Types.ObjectId,
    grant: Pick<PageDocument, 'grant' | 'grantedGroups'> = {
      grant: PageGrant.GRANT_PUBLIC,
      grantedGroups: [],
    },
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
      ...grant,
      revision: revisionId,
    });
  };

  const seedFlatChildren = async (
    srcPath: string,
    srcId: Types.ObjectId,
  ): Promise<void> => {
    const children = Array.from({ length: FLAT_CHILD_COUNT }, (_, i) => ({
      pageId: newId(),
      revisionId: newId(),
      path: `${srcPath}/p${String(i).padStart(3, '0')}`,
    }));
    await prisma.revisions.createMany({
      data: children.map((c) => ({
        id: c.revisionId,
        pageId: c.pageId,
        body: `body of ${c.path}`,
        format: 'markdown',
      })),
    });
    await Page.insertMany(
      children.map((c) => ({
        _id: c.pageId,
        path: c.path,
        parent: srcId,
        grant: PageGrant.GRANT_PUBLIC,
        revision: c.revisionId,
      })),
    );
  };

  // src/x, src/x/y, src/e (empty) and src/e/z
  const seedNestedChildren = async (
    srcPath: string,
    srcId: Types.ObjectId,
  ): Promise<void> => {
    const x = await createPageWithRevision(`${srcPath}/x`, srcId);
    await createPageWithRevision(`${srcPath}/x/y`, x._id);
    const e = await Page.create({
      path: `${srcPath}/e`,
      parent: srcId,
      isEmpty: true,
      grant: PageGrant.GRANT_PUBLIC,
    });
    await createPageWithRevision(`${srcPath}/e/z`, e._id);
  };
  const NESTED_NON_EMPTY_COUNT = 3;

  // The state duplicatePage leaves before starting the run:
  //   A/src (source top) with its descendants -- on the tree
  //   A/dest/copy (copy top)                  -- on the tree and counted by its ancestors
  //   a running PageOperation owned by this process
  const seedCase = async (
    name: string,
    {
      nested,
      foreignGroupId,
    }: {
      nested: boolean;
      /** Adds src/foreign, granted only to this group (which the owner is not in). */
      foreignGroupId?: string;
    },
  ) => {
    const aPath = `${PATH_ROOT}/${name}`;
    const srcPath = `${aPath}/src`;
    const destPath = `${aPath}/dest`;
    const toPath = `${destPath}/copy`;
    const sourceDescendantCount =
      FLAT_CHILD_COUNT +
      (nested ? NESTED_NON_EMPTY_COUNT : 0) +
      (foreignGroupId != null ? 1 : 0);

    const a = await Page.create({
      path: aPath,
      grant: PageGrant.GRANT_PUBLIC,
      parent: rootId,
      // src + its descendants + dest + copy top
      descendantCount: 1 + sourceDescendantCount + 2,
    });
    const src = await Page.create({
      path: srcPath,
      grant: PageGrant.GRANT_PUBLIC,
      parent: a._id,
      descendantCount: sourceDescendantCount,
    });
    await seedFlatChildren(srcPath, src._id);
    if (nested) {
      await seedNestedChildren(srcPath, src._id);
    }
    if (foreignGroupId != null) {
      await createPageWithRevision(`${srcPath}/foreign`, src._id, {
        grant: PageGrant.GRANT_USER_GROUP,
        grantedGroups: [{ item: foreignGroupId, type: GroupType.userGroup }],
      });
    }
    const dest = await Page.create({
      path: destPath,
      grant: PageGrant.GRANT_PUBLIC,
      parent: a._id,
      descendantCount: 1,
    });
    const copyTop = await Page.create({
      path: toPath,
      grant: PageGrant.GRANT_PUBLIC,
      parent: dest._id,
      descendantCount: 0,
    });

    const operation = await createDuplicatePageOperation({
      page: src,
      userId: String(owner._id),
      fromPath: srcPath,
      toPath,
    });
    return {
      aPath,
      srcPath,
      destPath,
      toPath,
      src,
      dest,
      copyTop,
      operation,
      sourceDescendantCount,
    };
  };

  type SeededCase = Awaited<ReturnType<typeof seedCase>>;

  const inputFor = (
    seeded: SeededCase,
    overrides: Partial<DescendantDuplicationInput> = {},
  ): DescendantDuplicationInput => ({
    operation: seeded.operation,
    sourcePage: seeded.src,
    newPagePath: seeded.toPath,
    user: owner,
    onlyDuplicateUserRelatedResources: false,
    ...overrides,
  });

  const findCopyDescendants = (toPath: string) =>
    Page.find({
      path: { $regex: `^${escapeStringForMongoRegex(`${toPath}/`)}` },
    }).lean();

  const countNonEmptyCopyDescendants = async (
    toPath: string,
  ): Promise<number> =>
    (await findCopyDescendants(toPath)).filter((p) => !p.isEmpty).length;

  /** Every page under the copy top hangs off the page at its parent path. */
  const expectCopyAttachedToTree = async (seeded: SeededCase) => {
    const top = await findByPath(seeded.toPath);
    expect(top?.parent?.toString()).toBe(seeded.dest._id.toString());
    const descendants = await findCopyDescendants(seeded.toPath);
    const pathById = new Map(
      [top, ...descendants].map((p) => [String(p?._id), p?.path]),
    );
    for (const page of descendants) {
      const parentPath = page.path.slice(0, page.path.lastIndexOf('/'));
      expect(pathById.get(String(page.parent))).toBe(parentPath);
    }
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

  /**
   * The real grant service, with a hook run when a batch starts reading the
   * user's groups (once per batch when onlyDuplicateUserRelatedResources is on).
   */
  const pageGrantServiceWith = (
    onBatch: (batchNumber: number) => Promise<void>,
  ): IPageGrantService => {
    const real = crowi.pageGrantService;
    let batchNumber = 0;
    return mock<IPageGrantService>({
      getUserRelatedGroups: async (user) => {
        batchNumber += 1;
        await onBatch(batchNumber);
        return real.getUserRelatedGroups(user);
      },
      isUserGrantedPageAccess: (...args) =>
        real.isUserGrantedPageAccess(...args),
      getUserRelatedGrantedGroupsSyncronously: (...args) =>
        real.getUserRelatedGrantedGroupsSyncronously(...args),
    });
  };

  const failingAtSecondBatch = (failure: Error) =>
    pageGrantServiceWith((batchNumber) =>
      batchNumber === 2 ? Promise.reject(failure) : Promise.resolve(),
    );

  /** The real page service, counting the calls that write to the page tree. */
  const recordingPageService = (
    overrides: Partial<DuplicatePagePort> = {},
  ): { pageService: DuplicatePagePort; callCount: () => number } => {
    const ps = crowi.pageService;
    let calls = 0;
    const counted =
      <A extends unknown[], R>(fn: (...args: A) => R) =>
      (...args: A): R => {
        calls += 1;
        return fn(...args);
      };
    const pageService: DuplicatePagePort = {
      create: (...args) => ps.create(...args),
      getParentAndFillAncestorsByUser: (...args) =>
        ps.getParentAndFillAncestorsByUser(...args),
      normalizeParentRecursively: counted((...args) =>
        ps.normalizeParentRecursively(...args),
      ),
      updateDescendantCountOfSelfAndDescendants: counted((...args) =>
        ps.updateDescendantCountOfSelfAndDescendants(...args),
      ),
      updateDescendantCountOfPagesWithPaths: counted((...args) =>
        ps.updateDescendantCountOfPagesWithPaths(...args),
      ),
      updateDescendantCountOfAncestors: counted((...args) =>
        ps.updateDescendantCountOfAncestors(...args),
      ),
      ...overrides,
    };
    return { pageService, callCount: () => calls };
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
    await InAppNotification.deleteMany({ user: { $in: createdUserIds } });
    await prisma.activities.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await Page.deleteMany({ path: { $regex: `^${PATH_ROOT}` } });
    await mongoose.model('User').deleteMany({ _id: { $in: createdUserIds } });
    await UserGroup.deleteMany({ _id: { $in: createdGroupIds } });
  });

  describe('when every batch succeeds', () => {
    it('copies every non-empty descendant and attaches the copies to the page tree (Req 3.2)', async () => {
      const seeded = await seedCase('success', { nested: true });

      await runDescendantDuplication(deps, inputFor(seeded));

      expect(await countNonEmptyCopyDescendants(seeded.toPath)).toBe(
        seeded.sourceDescendantCount,
      );
      // the empty source page is not copied; the tree gets an empty page in its place
      expect((await findByPath(`${seeded.toPath}/e`))?.isEmpty).toBe(true);
      await expectCopyAttachedToTree(seeded);
    });

    it('makes the copy and its ancestors report the real descendant counts', async () => {
      const seeded = await seedCase('success-count', { nested: true });

      await runDescendantDuplication(deps, inputFor(seeded));

      const copied = seeded.sourceDescendantCount;
      expect((await findByPath(seeded.toPath))?.descendantCount).toBe(copied);
      expect((await findByPath(seeded.destPath))?.descendantCount).toBe(
        copied + 1,
      );
      // A holds src and its descendants, dest, the copy top and the copies
      expect((await findByPath(seeded.aPath))?.descendantCount).toBe(
        1 + seeded.sourceDescendantCount + 2 + copied,
      );
    });

    it('adds only the copied pages to the ancestor counts when pages the user cannot view are skipped (Req 4.5)', async () => {
      const foreignGroup = await UserGroup.create({
        name: `${USERNAME_PREFIX}-foreign-${newId()}`,
      });
      createdGroupIds.push(String(foreignGroup._id));
      const seeded = await seedCase('success-viewable', {
        nested: true,
        foreignGroupId: String(foreignGroup._id),
      });
      const storedACount = (await findByPath(seeded.aPath))?.descendantCount;
      // every source descendant except src/foreign
      const viewableCount = seeded.sourceDescendantCount - 1;

      await runDescendantDuplication(
        deps,
        inputFor(seeded, { onlyDuplicateUserRelatedResources: true }),
      );

      expect(await findByPath(`${seeded.toPath}/foreign`)).toBeNull();
      expect(await countNonEmptyCopyDescendants(seeded.toPath)).toBe(
        viewableCount,
      );
      expect((await findByPath(seeded.toPath))?.descendantCount).toBe(
        viewableCount,
      );
      expect((await findByPath(seeded.destPath))?.descendantCount).toBe(
        viewableCount + 1,
      );
      expect((await findByPath(seeded.aPath))?.descendantCount).toBe(
        (storedACount ?? Number.NaN) + viewableCount,
      );
    });

    it('removes the PageOperation and notifies nobody (Req 3.2)', async () => {
      const seeded = await seedCase('success-op', { nested: false });

      await runDescendantDuplication(deps, inputFor(seeded));

      expect(await operationExists(seeded.operation)).toBe(false);
      await expectNoNotification(seeded.copyTop._id);
    });
  });

  describe('when a batch in the middle throws', () => {
    const runFailingAtSecondBatch = (
      seeded: SeededCase,
      overrides: Partial<DuplicateDeps> = {},
    ) =>
      runDescendantDuplication(
        {
          ...deps,
          pageGrantService: failingAtSecondBatch(new Error('batch failed')),
          ...overrides,
        },
        inputFor(seeded, { onlyDuplicateUserRelatedResources: true }),
      );

    it('keeps the partial copy reachable from the page tree with real counts (Req 4.1)', async () => {
      const seeded = await seedCase('error-tree', { nested: false });

      await expect(runFailingAtSecondBatch(seeded)).resolves.toBeUndefined();

      expect(await countNonEmptyCopyDescendants(seeded.toPath)).toBe(
        BULK_REINDEX_SIZE,
      );
      await expectCopyAttachedToTree(seeded);
      expect((await findByPath(seeded.toPath))?.descendantCount).toBe(
        BULK_REINDEX_SIZE,
      );
      expect((await findByPath(seeded.destPath))?.descendantCount).toBe(
        BULK_REINDEX_SIZE + 1,
      );
    });

    it('removes the PageOperation and notifies the duplicating user once (Req 4.1)', async () => {
      const seeded = await seedCase('error-notify', { nested: false });

      await runFailingAtSecondBatch(seeded);
      await waitForNotification(seeded.copyTop._id);
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(await operationExists(seeded.operation)).toBe(false);
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
        copiedPageCount: BULK_REINDEX_SIZE + 1,
        sourcePageCount: FLAT_CHILD_COUNT + 1,
      });
    });

    it('resolves and keeps the PageOperation for a later recovery when the recovery itself fails', async () => {
      const seeded = await seedCase('error-recovery-fails', {
        nested: false,
      });
      const { pageService } = recordingPageService({
        updateDescendantCountOfSelfAndDescendants: () =>
          Promise.reject(new Error('database unavailable')),
      });

      await expect(
        runFailingAtSecondBatch(seeded, { pageService }),
      ).resolves.toBeUndefined();

      expect(await operationExists(seeded.operation)).toBe(true);
      await expectNoNotification(seeded.copyTop._id);
    });
  });

  describe('when another process takes the duplicate over (Req 4.4)', () => {
    const takeOverByAnotherProcess = async (): Promise<void> => {
      if ((await takeOverStalledDuplicate(afterStall())) == null) {
        throw new Error('expected to take the PageOperation over');
      }
    };

    it('stops without writing further, keeps the PageOperation and notifies nobody', async () => {
      const seeded = await seedCase('lost', { nested: false });
      const pageGrantService = pageGrantServiceWith(async (batchNumber) => {
        if (batchNumber === 2) {
          await takeOverByAnotherProcess();
        }
      });
      const { pageService, callCount } = recordingPageService();

      await expect(
        runDescendantDuplication(
          { ...deps, pageGrantService, pageService },
          inputFor(seeded, { onlyDuplicateUserRelatedResources: true }),
        ),
      ).resolves.toBeUndefined();

      // the second batch and the sub operation are left to the new owner
      expect(await countNonEmptyCopyDescendants(seeded.toPath)).toBe(
        BULK_REINDEX_SIZE,
      );
      expect(callCount()).toBe(0);
      const copies = await findCopyDescendants(seeded.toPath);
      expect(copies.every((p) => p.parent == null)).toBe(true);
      expect(await operationExists(seeded.operation)).toBe(true);
      await expectNoNotification(seeded.copyTop._id);
    });

    it('stops the sub operation without updating counts, deleting or notifying', async () => {
      const seeded = await seedCase('lost-sub-op', { nested: false });
      const { pageService } = recordingPageService({
        updateDescendantCountOfSelfAndDescendants: async (...args) => {
          await takeOverByAnotherProcess();
          return crowi.pageService.updateDescendantCountOfSelfAndDescendants(
            ...args,
          );
        },
      });

      await expect(
        runDescendantDuplication({ ...deps, pageService }, inputFor(seeded)),
      ).resolves.toBeUndefined();

      expect((await findByPath(seeded.toPath))?.descendantCount).toBe(0);
      expect((await findByPath(seeded.destPath))?.descendantCount).toBe(1);
      expect(await operationExists(seeded.operation)).toBe(true);
      await expectNoNotification(seeded.copyTop._id);
    });
  });
});
