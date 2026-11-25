import { type IUserHasId, PageGrant } from '@growi/core';
import { ConfigSource } from '@growi/core/dist/interfaces';
import { escapeStringForMongoRegex } from '@growi/core/dist/utils';
import type { HydratedDocument } from 'mongoose';
import mongoose, { Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { PageActionType } from '~/interfaces/page-operation';
import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import PageOperation from '~/server/models/page-operation';
import { prisma } from '~/utils/prisma';

import {
  PageOperationRefusalReason,
  PageOperationRefusedError,
} from '../page-operation-refusal';
import { duplicatePage } from './duplicate-page';
import type { DuplicateDeps, DuplicatePagePort } from './duplicate-page-port';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PATH_ROOT = `/duplicate-page-integ-${WORKER_ID}`;
const USERNAME_PREFIX = `duplicatePageInteg${WORKER_ID}`;

const newId = (): string => new Types.ObjectId().toHexString();

/** A promise the test resolves by hand, to keep the descendant run open. */
const createGate = () => {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
};

describe('duplicatePage', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let owner: HydratedDocument<IUserHasId>;
  let otherUser: HydratedDocument<IUserHasId>;
  let rootId: Types.ObjectId;
  let isV5CompatibleInDbBefore: boolean | undefined;
  const createdUserIds: string[] = [];

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

  /**
   * The real collaborators. The sub operation run after the descendants are
   * copied waits for `hold` when one is given, so the run stays in progress.
   */
  const depsWith = (
    hold?: Promise<void>,
    overrides: Partial<DuplicateDeps> = {},
  ): DuplicateDeps => {
    const ps = crowi.pageService;
    const { activityService } = crowi;
    if (activityService == null) {
      throw new Error('activityService is not initialized');
    }
    const pageService: DuplicatePagePort = {
      create: (...args) => ps.create(...args),
      getParentAndFillAncestorsByUser: (...args) =>
        ps.getParentAndFillAncestorsByUser(...args),
      normalizeParentRecursively: (...args) =>
        ps.normalizeParentRecursively(...args),
      updateDescendantCountOfSelfAndDescendants: async (...args) => {
        await hold;
        return ps.updateDescendantCountOfSelfAndDescendants(...args);
      },
      updateDescendantCountOfPagesWithPaths: (...args) =>
        ps.updateDescendantCountOfPagesWithPaths(...args),
      updateDescendantCountOfAncestors: (...args) =>
        ps.updateDescendantCountOfAncestors(...args),
    };
    return {
      pageService,
      pageGrantService: crowi.pageGrantService,
      pageOperationService: crowi.pageOperationService,
      activityService,
      pageEvent: crowi.events.page,
      tagEvent: crowi.events.tag,
      activityEvent: crowi.events.activity,
      ...overrides,
    };
  };

  const createPageWithRevision = async (
    path: string,
    parent: Types.ObjectId | null,
    grant: Partial<Pick<PageDocument, 'grant' | 'grantedUsers'>> = {},
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
      ...grant,
      revision: revisionId,
    });
  };

  /** A v5 source page with two children and one grandchild, on the page tree. */
  const seedV5Source = async (name: string) => {
    const basePath = `${PATH_ROOT}/${name}`;
    const base = await Page.create({
      path: basePath,
      grant: PageGrant.GRANT_PUBLIC,
      parent: rootId,
      descendantCount: 4,
    });
    const srcPath = `${basePath}/src`;
    const src = await createPageWithRevision(srcPath, base._id);
    const a = await createPageWithRevision(`${srcPath}/a`, src._id);
    await createPageWithRevision(`${srcPath}/a/b`, a._id);
    await createPageWithRevision(`${srcPath}/c`, src._id);
    await Page.updateOne({ _id: src._id }, { descendantCount: 3 });
    const source = await Page.findById(src._id).orFail();
    return {
      base,
      basePath,
      srcPath,
      source,
      newPagePath: `${basePath}/copy`,
      descendantPaths: ['/a', '/a/b', '/c'],
    };
  };

  const findDescendantCopies = (newPagePath: string) =>
    Page.find({
      path: { $regex: `^${escapeStringForMongoRegex(`${newPagePath}/`)}` },
    }).lean();

  const findDuplicateOperation = (fromPath: string) =>
    PageOperation.findOne({ actionType: PageActionType.Duplicate, fromPath });

  const waitUntilOperationGone = (fromPath: string) =>
    vi.waitFor(
      async () => {
        expect(await findDuplicateOperation(fromPath)).toBeNull();
      },
      { timeout: 4000, interval: 50 },
    );

  const bodyOf = async (page: { revision?: unknown }) =>
    (
      await prisma.revisions.findUnique({
        where: { id: String(page.revision) },
      })
    )?.body;

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    isV5CompatibleInDbBefore = crowi.configManager.getConfig(
      'app:isV5Compatible',
      ConfigSource.db,
    );
    await crowi.configManager.updateConfig('app:isV5Compatible', true);
    await Page.deleteMany({ path: { $regex: `^${PATH_ROOT}` } });
    owner = await createUser();
    otherUser = await createUser();
    const root =
      (await Page.findOne({ path: '/' })) ??
      (await Page.create({ path: '/', grant: PageGrant.GRANT_PUBLIC }));
    rootId = root._id;
  }, 60_000);

  // canOperate looks at every PageOperation, so leftovers from other files in
  // this worker's database must not refuse these duplicates.
  beforeEach(async () => {
    await PageOperation.deleteMany({});
  });

  afterAll(async () => {
    await PageOperation.deleteMany({ actionType: PageActionType.Duplicate });
    await Page.deleteMany({ path: { $regex: `^${PATH_ROOT}` } });
    await mongoose.model('User').deleteMany({ _id: { $in: createdUserIds } });
    await crowi.configManager.updateConfigs(
      { 'app:isV5Compatible': isV5CompatibleInDbBefore },
      { removeIfUndefined: true },
    );
  });

  describe('a v5 page with its descendants', () => {
    it('returns the copy of the top page with its body and tags before the descendant run finishes (Req 6.1)', async () => {
      const seeded = await seedV5Source('immediate');
      await prisma.pagetagrelations.updatePageTags(seeded.source._id, [
        `${USERNAME_PREFIX}-tag`,
      ]);
      const gate = createGate();

      try {
        const result = await duplicatePage(depsWith(gate.opened), {
          page: seeded.source,
          newPagePath: seeded.newPagePath,
          user: owner,
          isRecursively: true,
          onlyDuplicateUserRelatedResources: false,
        });

        expect(result.path).toBe(seeded.newPagePath);
        expect(result.tags).toEqual([`${USERNAME_PREFIX}-tag`]);
        const top = await Page.findOne({ path: seeded.newPagePath }).lean();
        expect(top?._id.toString()).toBe(result._id.toString());
        expect(top?.parent?.toString()).toBe(seeded.base._id.toString());
        expect(await bodyOf(top ?? {})).toBe(`body of ${seeded.srcPath}`);
        // the run is held before its sub operation, so the copy is not complete yet
        expect(await findDuplicateOperation(seeded.srcPath)).not.toBeNull();
      } finally {
        gate.open();
        await waitUntilOperationGone(seeded.srcPath);
      }
    });

    it('keeps a PageOperation the recovery can read while the descendants are copied, and removes it when done (Req 3.1, 3.2)', async () => {
      const seeded = await seedV5Source('operation');
      const gate = createGate();

      try {
        await duplicatePage(depsWith(gate.opened), {
          page: seeded.source,
          newPagePath: seeded.newPagePath,
          user: owner,
          isRecursively: true,
          onlyDuplicateUserRelatedResources: false,
        });

        const operation = await findDuplicateOperation(seeded.srcPath);
        expect(operation?.toPath).toBe(seeded.newPagePath);
        expect(operation?.user._id.toString()).toBe(owner._id.toString());
        expect(operation?.page.grant).toBe(PageGrant.GRANT_PUBLIC);
        expect(operation?.page.descendantCount).toBe(3);
        expect(operation?.ownerToken).toEqual(expect.any(String));
        expect(operation?.lastProgressAt).toBeInstanceOf(Date);
      } finally {
        gate.open();
      }

      await waitUntilOperationGone(seeded.srcPath);
      const top = await Page.findOne({ path: seeded.newPagePath }).lean();
      const copies = await findDescendantCopies(seeded.newPagePath);
      expect(copies.map((p) => p.path).sort()).toEqual(
        seeded.descendantPaths.map((p) => `${seeded.newPagePath}${p}`).sort(),
      );
      const idByPath = new Map(
        [top, ...copies].map((p) => [p?.path, String(p?._id)]),
      );
      for (const copy of copies) {
        const parentPath = copy.path.slice(0, copy.path.lastIndexOf('/'));
        expect(String(copy.parent)).toBe(idByPath.get(parentPath));
        // biome-ignore lint/performance/noAwaitInLoops: three pages, readability first
        expect(await bodyOf(copy)).toBe(
          `body of ${copy.path.replace(seeded.newPagePath, seeded.srcPath)}`,
        );
      }
      expect(top?.descendantCount).toBe(3);
    });

    it('refuses an overlapping duplicate while the descendants are being copied (Req 3.1)', async () => {
      const seeded = await seedV5Source('overlap');
      const gate = createGate();

      try {
        await duplicatePage(depsWith(gate.opened), {
          page: seeded.source,
          newPagePath: seeded.newPagePath,
          user: owner,
          isRecursively: true,
          onlyDuplicateUserRelatedResources: false,
        });

        const overlapping = duplicatePage(depsWith(), {
          page: seeded.source,
          newPagePath: `${seeded.basePath}/copy-again`,
          user: owner,
          isRecursively: true,
          onlyDuplicateUserRelatedResources: false,
        });

        await expect(overlapping).rejects.toBeInstanceOf(
          PageOperationRefusedError,
        );
        await expect(overlapping).rejects.toMatchObject({
          reason: PageOperationRefusalReason.OPERATION_IN_PROGRESS,
        });
        expect(
          await Page.exists({ path: `${seeded.basePath}/copy-again` }),
        ).toBeNull();
      } finally {
        gate.open();
        await waitUntilOperationGone(seeded.srcPath);
      }
    });
  });

  it('copies only the top page and leaves no PageOperation when not recursive', async () => {
    const seeded = await seedV5Source('single');

    const result = await duplicatePage(depsWith(), {
      page: seeded.source,
      newPagePath: seeded.newPagePath,
      user: owner,
      isRecursively: false,
      onlyDuplicateUserRelatedResources: false,
    });

    expect(result.path).toBe(seeded.newPagePath);
    expect(await findDuplicateOperation(seeded.srcPath)).toBeNull();
    // give a wrongly started descendant run time to write
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await findDescendantCopies(seeded.newPagePath)).toHaveLength(0);
  });

  it('refuses a grant that cannot be assigned at the destination, creating nothing (Req 6.2)', async () => {
    const seeded = await seedV5Source('grant');
    // a public copy may not sit under a page only another user can see
    const privateParent = await createPageWithRevision(
      `${seeded.basePath}/private`,
      rootId,
      { grant: PageGrant.GRANT_OWNER, grantedUsers: [otherUser._id] },
    );
    const newPagePath = `${privateParent.path}/copy`;

    const duplicating = duplicatePage(depsWith(), {
      page: seeded.source,
      newPagePath,
      user: owner,
      isRecursively: true,
      onlyDuplicateUserRelatedResources: false,
    });

    await expect(duplicating).rejects.toBeInstanceOf(PageOperationRefusedError);
    await expect(duplicating).rejects.toMatchObject({
      reason: PageOperationRefusalReason.GRANT_NOT_ASSIGNABLE,
    });
    expect(await Page.exists({ path: newPagePath })).toBeNull();
    expect(await findDuplicateOperation(seeded.srcPath)).toBeNull();
  });

  it('rejects with the storage error when the PageOperation cannot be created, and copies no descendant', async () => {
    const seeded = await seedV5Source('op-failure');
    const failure = new Error('PageOperation could not be stored');
    const createSpy = vi
      .spyOn(PageOperation, 'create')
      .mockRejectedValueOnce(failure);

    try {
      await expect(
        duplicatePage(depsWith(), {
          page: seeded.source,
          newPagePath: seeded.newPagePath,
          user: owner,
          isRecursively: true,
          onlyDuplicateUserRelatedResources: false,
        }),
      ).rejects.toBe(failure);
    } finally {
      createSpy.mockRestore();
    }

    // the top page is written before the PageOperation, so it is left behind
    expect(await Page.exists({ path: seeded.newPagePath })).not.toBeNull();
    expect(await findDuplicateOperation(seeded.srcPath)).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await findDescendantCopies(seeded.newPagePath)).toHaveLength(0);
  });

  it('copies the descendants of a v4 page without a PageOperation (Req 1.3)', async () => {
    // v4 pages sit outside the page tree: parent is null
    const srcPath = `${PATH_ROOT}/v4/src`;
    const source = await createPageWithRevision(srcPath, null);
    await createPageWithRevision(`${srcPath}/a`, null);
    await createPageWithRevision(`${srcPath}/a/b`, null);
    const newPagePath = `${PATH_ROOT}/v4/copy`;
    // Holds the first write of the copied descendants, so the run stays in progress.
    const gate = createGate();
    const insertMany = Page.insertMany;
    const isDescendantCopy = (doc: unknown): boolean =>
      typeof doc === 'object' &&
      doc != null &&
      'path' in doc &&
      String(doc.path).startsWith(`${newPagePath}/`);
    let isHeld = false;
    const insertManySpy = vi.spyOn(Page, 'insertMany').mockImplementation(
      // WHY cast: insertMany is a set of overloads no single implementation satisfies.
      (async (...args: unknown[]) => {
        if (!isHeld && [args[0]].flat().some(isDescendantCopy)) {
          isHeld = true;
          await gate.opened;
        }
        return Reflect.apply(insertMany, Page, args);
      }) as typeof Page.insertMany,
    );

    try {
      const result = await duplicatePage(depsWith(), {
        page: source,
        newPagePath,
        user: owner,
        isRecursively: true,
        onlyDuplicateUserRelatedResources: false,
      });

      // resolved while the descendant run is still held (Req 6.1)
      expect(result.path).toBe(newPagePath);
      expect(await findDescendantCopies(newPagePath)).toHaveLength(0);
      expect(await findDuplicateOperation(srcPath)).toBeNull();
    } finally {
      gate.open();
      insertManySpy.mockRestore();
    }

    await vi.waitFor(
      async () => {
        expect(await findDescendantCopies(newPagePath)).toHaveLength(2);
      },
      { timeout: 4000, interval: 50 },
    );
    const copies = await findDescendantCopies(newPagePath);
    for (const copy of copies) {
      // biome-ignore lint/performance/noAwaitInLoops: two pages, readability first
      expect(await bodyOf(copy)).toBe(
        `body of ${copy.path.replace(newPagePath, srcPath)}`,
      );
    }
  });
});
