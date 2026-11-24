import type { IPage } from '@growi/core';
import mongoose, { type Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PATH_ROOT = `/descendant-batch-progress-integ-${WORKER_ID}`;
const USERNAME = `descendantBatchProgressInteg${WORKER_ID}`;

// updateDescendantCountOfSelfAndDescendants / updateDescendantCountOfPagesWithPaths
// recount in batches of BATCH_SIZE = 200 (see PageService).
const RECOUNT_WRAPPER_BATCH_SIZE = 200;
// _normalizeParentRecursively processes orphans in batches of BATCH_SIZE = 100,
// and splits the work into several recursive passes above PAGES_LIMIT = 1000.
const NORMALIZE_BATCH_SIZE = 100;
const NORMALIZE_PAGES_LIMIT = 1000;
// The recursive passes only start above PAGES_LIMIT orphans, so the tests that
// reach them seed over 2000 pages; that exceeds the default 5 s on CI runners.
const RECURSIVE_PASS_TEST_TIMEOUT_MS = 20_000;

const countingOnBatchStart = () => {
  let calls = 0;
  const onBatchStart = (): Promise<void> => {
    calls++;
    return Promise.resolve();
  };
  return { onBatchStart, getCalls: () => calls };
};

const throwingOnBatchStart = (error: Error) => {
  let calls = 0;
  const onBatchStart = (): Promise<void> => {
    calls++;
    return Promise.reject(error);
  };
  return { onBatchStart, getCalls: () => calls };
};

describe('PageService descendant batch processing: onBatchStart and error propagation', () => {
  let crowi: Crowi;
  let Page: PageModel;
  // Parent of every top page seeded here, itself on the tree
  let pathRoot: PageDocument;
  let user: { readonly _id: Types.ObjectId };

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<IPage, PageModel>('Page');

    await Page.deleteMany({ path: { $regex: `^${PATH_ROOT}(/|$)` } });
    await mongoose.model('User').deleteMany({ username: USERNAME });

    const rootPage =
      (await Page.findOne({ path: '/' })) ??
      (await Page.create({ path: '/', grant: Page.GRANT_PUBLIC }));
    pathRoot = await Page.create({
      path: PATH_ROOT,
      parent: rootPage._id,
      grant: Page.GRANT_PUBLIC,
    });

    user = await mongoose.model('User').create({
      name: USERNAME,
      username: USERNAME,
      email: `${USERNAME}@example.com`,
    });
  });

  afterAll(async () => {
    await Page.deleteMany({ path: { $regex: `^${PATH_ROOT}(/|$)` } });
    await mongoose.model('User').deleteMany({ _id: user._id });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Creates `top` on the tree and `count` pages directly under it, also on the
   * tree, all with a deliberately wrong descendantCount.
   */
  const seedAttachedTree = async (
    top: string,
    count: number,
  ): Promise<{ topId: Types.ObjectId; childPaths: string[] }> => {
    const topId = new mongoose.Types.ObjectId();
    const childPaths = Array.from(
      { length: count },
      (_, i) => `${top}/c${String(i).padStart(4, '0')}`,
    );
    await Page.insertMany([
      {
        _id: topId,
        path: top,
        parent: pathRoot._id,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
        descendantCount: 9999,
      },
      ...childPaths.map((path) => ({
        path,
        parent: topId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
        descendantCount: 9999,
      })),
    ]);
    return { topId, childPaths };
  };

  /**
   * Creates `top` and `count` intermediate pages on the tree, each with one
   * child whose parent is missing. Distinct parents keep each batch's
   * re-parenting confined to that batch's own orphans.
   */
  const seedOrphans = async (
    top: string,
    count: number,
  ): Promise<{ orphanPaths: string[] }> => {
    const topId = new mongoose.Types.ObjectId();
    const parents = Array.from({ length: count }, (_, i) => ({
      _id: new mongoose.Types.ObjectId(),
      path: `${top}/p${String(i).padStart(4, '0')}`,
    }));
    const orphanPaths = parents.map((p) => `${p.path}/c`);
    await Page.insertMany([
      {
        _id: topId,
        path: top,
        parent: pathRoot._id,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
      },
      ...parents.map((p) => ({
        _id: p._id,
        path: p.path,
        parent: topId,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
      })),
      ...orphanPaths.map((path) => ({
        path,
        parent: null,
        grant: Page.GRANT_PUBLIC,
        isEmpty: false,
      })),
    ]);
    return { orphanPaths };
  };

  const countOrphans = (paths: string[]): Promise<number> =>
    Page.countDocuments({ path: { $in: paths }, parent: null }).exec();

  describe('normalizeParentRecursively', () => {
    it('calls onBatchStart once per batch and still attaches every orphan', async () => {
      const nOrphans = NORMALIZE_BATCH_SIZE + 50;
      const { orphanPaths } = await seedOrphans(
        `${PATH_ROOT}/bp-normalize-ok`,
        nOrphans,
      );
      const { onBatchStart, getCalls } = countingOnBatchStart();

      await crowi.pageService.normalizeParentRecursively(
        [`${PATH_ROOT}/bp-normalize-ok`],
        user,
        true,
        false,
        onBatchStart,
      );

      expect(getCalls()).toBe(Math.ceil(nOrphans / NORMALIZE_BATCH_SIZE));
      expect(await countOrphans(orphanPaths)).toBe(0);
    });

    it('rejects with the error thrown by onBatchStart without touching the batch', async () => {
      const { orphanPaths } = await seedOrphans(
        `${PATH_ROOT}/bp-normalize-cb-err`,
        3,
      );
      const error = new Error('onBatchStart failed');
      const { onBatchStart, getCalls } = throwingOnBatchStart(error);

      await expect(
        crowi.pageService.normalizeParentRecursively(
          [`${PATH_ROOT}/bp-normalize-cb-err`],
          user,
          true,
          false,
          onBatchStart,
        ),
      ).rejects.toBe(error);

      expect(getCalls()).toBe(1);
      expect(await countOrphans(orphanPaths)).toBe(orphanPaths.length);
    });

    it(
      'keeps calling onBatchStart in the passes after the first one',
      async () => {
        const nOrphans = NORMALIZE_PAGES_LIMIT + 1;
        const { orphanPaths } = await seedOrphans(
          `${PATH_ROOT}/bp-normalize-multi-pass`,
          nOrphans,
        );
        const { onBatchStart, getCalls } = countingOnBatchStart();

        await crowi.pageService.normalizeParentRecursively(
          [`${PATH_ROOT}/bp-normalize-multi-pass`],
          user,
          true,
          false,
          onBatchStart,
        );

        expect(await countOrphans(orphanPaths)).toBe(0);
        expect(getCalls()).toBeGreaterThanOrEqual(
          Math.ceil(nOrphans / NORMALIZE_BATCH_SIZE),
        );
      },
      RECURSIVE_PASS_TEST_TIMEOUT_MS,
    );

    it(
      'rejects with the error thrown by onBatchStart in a later pass',
      async () => {
        await seedOrphans(
          `${PATH_ROOT}/bp-normalize-multi-pass-err`,
          NORMALIZE_PAGES_LIMIT + 1,
        );
        const error = new Error('onBatchStart failed in a later pass');
        // Above PAGES_LIMIT the first pass takes well under half of the orphans,
        // so this call lands in a recursive pass.
        const failingCall =
          Math.ceil(NORMALIZE_PAGES_LIMIT / 2 / NORMALIZE_BATCH_SIZE) + 1;
        let calls = 0;
        const onBatchStart = (): Promise<void> => {
          calls++;
          return calls >= failingCall
            ? Promise.reject(error)
            : Promise.resolve();
        };

        await expect(
          crowi.pageService.normalizeParentRecursively(
            [`${PATH_ROOT}/bp-normalize-multi-pass-err`],
            user,
            true,
            false,
            onBatchStart,
          ),
        ).rejects.toBe(error);
      },
      RECURSIVE_PASS_TEST_TIMEOUT_MS,
    );

    it('rejects with a DB error raised inside a batch', async () => {
      await seedOrphans(`${PATH_ROOT}/bp-normalize-db-err`, 3);
      const error = new Error('bulkWrite failed');
      vi.spyOn(Page, 'bulkWrite').mockRejectedValueOnce(error);

      await expect(
        crowi.pageService.normalizeParentRecursively(
          [`${PATH_ROOT}/bp-normalize-db-err`],
          user,
          true,
        ),
      ).rejects.toBe(error);
    });
  });

  describe('updateDescendantCountOfSelfAndDescendants', () => {
    it('calls onBatchStart once per batch and still recounts every page', async () => {
      const nChildren = RECOUNT_WRAPPER_BATCH_SIZE + 50;
      const { topId } = await seedAttachedTree(
        `${PATH_ROOT}/bp-self-ok`,
        nChildren,
      );
      const { onBatchStart, getCalls } = countingOnBatchStart();

      await crowi.pageService.updateDescendantCountOfSelfAndDescendants(
        `${PATH_ROOT}/bp-self-ok`,
        onBatchStart,
      );

      // nChildren pages plus the top page itself
      expect(getCalls()).toBe(
        Math.ceil((nChildren + 1) / RECOUNT_WRAPPER_BATCH_SIZE),
      );
      expect((await Page.findById(topId))?.descendantCount).toBe(nChildren);
    });

    it('rejects with the error thrown by onBatchStart without touching the batch', async () => {
      const { topId } = await seedAttachedTree(
        `${PATH_ROOT}/bp-self-cb-err`,
        3,
      );
      const error = new Error('onBatchStart failed');
      const { onBatchStart, getCalls } = throwingOnBatchStart(error);

      await expect(
        crowi.pageService.updateDescendantCountOfSelfAndDescendants(
          `${PATH_ROOT}/bp-self-cb-err`,
          onBatchStart,
        ),
      ).rejects.toBe(error);

      expect(getCalls()).toBe(1);
      expect((await Page.findById(topId))?.descendantCount).toBe(9999);
    });

    it('rejects with a DB error raised inside a batch', async () => {
      await seedAttachedTree(`${PATH_ROOT}/bp-self-db-err`, 3);
      const error = new Error('recount failed');
      vi.spyOn(Page, 'recountDescendantCount').mockRejectedValueOnce(error);

      await expect(
        crowi.pageService.updateDescendantCountOfSelfAndDescendants(
          `${PATH_ROOT}/bp-self-db-err`,
        ),
      ).rejects.toBe(error);
    });
  });

  describe('updateDescendantCountOfPagesWithPaths', () => {
    it('calls onBatchStart once per batch and still recounts every page', async () => {
      const nChildren = RECOUNT_WRAPPER_BATCH_SIZE + 50;
      const { topId, childPaths } = await seedAttachedTree(
        `${PATH_ROOT}/bp-paths-ok`,
        nChildren,
      );
      const paths = [`${PATH_ROOT}/bp-paths-ok`, ...childPaths];
      const { onBatchStart, getCalls } = countingOnBatchStart();

      await crowi.pageService.updateDescendantCountOfPagesWithPaths(
        paths,
        onBatchStart,
      );

      expect(getCalls()).toBe(
        Math.ceil(paths.length / RECOUNT_WRAPPER_BATCH_SIZE),
      );
      expect((await Page.findById(topId))?.descendantCount).toBe(nChildren);
    });

    it('rejects with the error thrown by onBatchStart without touching the batch', async () => {
      const { topId, childPaths } = await seedAttachedTree(
        `${PATH_ROOT}/bp-paths-cb-err`,
        3,
      );
      const error = new Error('onBatchStart failed');
      const { onBatchStart, getCalls } = throwingOnBatchStart(error);

      await expect(
        crowi.pageService.updateDescendantCountOfPagesWithPaths(
          [`${PATH_ROOT}/bp-paths-cb-err`, ...childPaths],
          onBatchStart,
        ),
      ).rejects.toBe(error);

      expect(getCalls()).toBe(1);
      expect((await Page.findById(topId))?.descendantCount).toBe(9999);
    });

    it('rejects with a DB error raised inside a batch', async () => {
      const { childPaths } = await seedAttachedTree(
        `${PATH_ROOT}/bp-paths-db-err`,
        3,
      );
      const error = new Error('recount failed');
      vi.spyOn(Page, 'recountDescendantCount').mockRejectedValueOnce(error);

      await expect(
        crowi.pageService.updateDescendantCountOfPagesWithPaths([
          `${PATH_ROOT}/bp-paths-db-err`,
          ...childPaths,
        ]),
      ).rejects.toBe(error);
    });
  });

  describe('recountAndUpdateDescendantCountOfPages', () => {
    // Built the same way as the production callers (deepest path first).
    const cursorUnder = (top: string) =>
      new Page.PageQueryBuilder(Page.find(), true)
        .addConditionToListWithDescendants(top)
        .addConditionToSortPagesByDescPath()
        .query.lean()
        .cursor();

    it('calls onBatchStart once per batch of the given size', async () => {
      const { topId } = await seedAttachedTree(`${PATH_ROOT}/bp-recount-ok`, 4);
      const { onBatchStart, getCalls } = countingOnBatchStart();

      // 5 pages in batches of 2
      await crowi.pageService.recountAndUpdateDescendantCountOfPages(
        cursorUnder(`${PATH_ROOT}/bp-recount-ok`),
        2,
        onBatchStart,
      );

      expect(getCalls()).toBe(3);
      expect((await Page.findById(topId))?.descendantCount).toBe(4);
    });

    it('rejects with the error thrown by onBatchStart without touching the batch', async () => {
      const { topId } = await seedAttachedTree(
        `${PATH_ROOT}/bp-recount-cb-err`,
        1,
      );
      const error = new Error('onBatchStart failed');
      const { onBatchStart, getCalls } = throwingOnBatchStart(error);

      await expect(
        crowi.pageService.recountAndUpdateDescendantCountOfPages(
          cursorUnder(`${PATH_ROOT}/bp-recount-cb-err`),
          10,
          onBatchStart,
        ),
      ).rejects.toBe(error);

      expect(getCalls()).toBe(1);
      expect((await Page.findById(topId))?.descendantCount).toBe(9999);
    });

    it('rejects with a DB error raised inside a batch', async () => {
      await seedAttachedTree(`${PATH_ROOT}/bp-recount-db-err`, 1);
      const error = new Error('findByIdAndUpdate failed');
      vi.spyOn(Page, 'findByIdAndUpdate').mockImplementationOnce(() => {
        throw error;
      });

      await expect(
        crowi.pageService.recountAndUpdateDescendantCountOfPages(
          cursorUnder(`${PATH_ROOT}/bp-recount-db-err`),
          10,
        ),
      ).rejects.toBe(error);
    });
  });
});
