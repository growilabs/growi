import type { IPage } from '@growi/core';
import mongoose, { type Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';

// A hang (the failure mode these tests guard against) must fail fast instead of
// waiting for the project-wide 60s test timeout.
const HANG_TIMEOUT_MS = 15_000;

// updateDescendantCountOfSelfAndDescendants / updateDescendantCountOfPagesWithPaths
// recount in batches of BATCH_SIZE = 200 (see PageService).
const RECOUNT_WRAPPER_BATCH_SIZE = 200;
// _normalizeParentRecursively processes orphans in batches of BATCH_SIZE = 100,
// and splits the work into several recursive passes above PAGES_LIMIT = 1000.
const NORMALIZE_BATCH_SIZE = 100;
const NORMALIZE_PAGES_LIMIT = 1000;

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
  let rootPage: PageDocument;
  let user: { readonly _id: Types.ObjectId };

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<IPage, PageModel>('Page');

    const existingRootPage = await Page.findOne({ path: '/' });
    rootPage =
      existingRootPage ??
      (await Page.create({ path: '/', grant: Page.GRANT_PUBLIC }));

    user = await mongoose.model('User').create({
      name: 'batchProgressUser',
      username: 'batchProgressUser',
      email: 'batchProgressUser@example.com',
    });
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
        parent: rootPage._id,
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
        parent: rootPage._id,
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
    it(
      'calls onBatchStart once per batch and still attaches every orphan',
      async () => {
        const nOrphans = NORMALIZE_BATCH_SIZE + 50;
        const { orphanPaths } = await seedOrphans('/bp-normalize-ok', nOrphans);
        const { onBatchStart, getCalls } = countingOnBatchStart();

        await crowi.pageService.normalizeParentRecursively(
          ['/bp-normalize-ok'],
          user,
          true,
          false,
          onBatchStart,
        );

        expect(getCalls()).toBe(Math.ceil(nOrphans / NORMALIZE_BATCH_SIZE));
        expect(await countOrphans(orphanPaths)).toBe(0);
      },
      HANG_TIMEOUT_MS,
    );

    it(
      'rejects with the error thrown by onBatchStart without touching the batch',
      async () => {
        const { orphanPaths } = await seedOrphans('/bp-normalize-cb-err', 3);
        const error = new Error('onBatchStart failed');
        const { onBatchStart, getCalls } = throwingOnBatchStart(error);

        await expect(
          crowi.pageService.normalizeParentRecursively(
            ['/bp-normalize-cb-err'],
            user,
            true,
            false,
            onBatchStart,
          ),
        ).rejects.toBe(error);

        expect(getCalls()).toBe(1);
        expect(await countOrphans(orphanPaths)).toBe(orphanPaths.length);
      },
      HANG_TIMEOUT_MS,
    );

    it(
      'keeps calling onBatchStart in the passes after the first one',
      async () => {
        const nOrphans = NORMALIZE_PAGES_LIMIT + 1;
        const { orphanPaths } = await seedOrphans(
          '/bp-normalize-multi-pass',
          nOrphans,
        );
        const { onBatchStart, getCalls } = countingOnBatchStart();

        await crowi.pageService.normalizeParentRecursively(
          ['/bp-normalize-multi-pass'],
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
      HANG_TIMEOUT_MS,
    );

    it(
      'rejects with the error thrown by onBatchStart in a later pass',
      async () => {
        await seedOrphans(
          '/bp-normalize-multi-pass-err',
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
            ['/bp-normalize-multi-pass-err'],
            user,
            true,
            false,
            onBatchStart,
          ),
        ).rejects.toBe(error);
      },
      HANG_TIMEOUT_MS,
    );

    it(
      'rejects with a DB error raised inside a batch',
      async () => {
        await seedOrphans('/bp-normalize-db-err', 3);
        const error = new Error('bulkWrite failed');
        vi.spyOn(Page, 'bulkWrite').mockRejectedValueOnce(error);

        await expect(
          crowi.pageService.normalizeParentRecursively(
            ['/bp-normalize-db-err'],
            user,
            true,
          ),
        ).rejects.toBe(error);
      },
      HANG_TIMEOUT_MS,
    );
  });

  describe('updateDescendantCountOfSelfAndDescendants', () => {
    it(
      'calls onBatchStart once per batch and still recounts every page',
      async () => {
        const nChildren = RECOUNT_WRAPPER_BATCH_SIZE + 50;
        const { topId } = await seedAttachedTree('/bp-self-ok', nChildren);
        const { onBatchStart, getCalls } = countingOnBatchStart();

        await crowi.pageService.updateDescendantCountOfSelfAndDescendants(
          '/bp-self-ok',
          onBatchStart,
        );

        // nChildren pages plus the top page itself
        expect(getCalls()).toBe(
          Math.ceil((nChildren + 1) / RECOUNT_WRAPPER_BATCH_SIZE),
        );
        expect((await Page.findById(topId))?.descendantCount).toBe(nChildren);
      },
      HANG_TIMEOUT_MS,
    );

    it(
      'rejects with the error thrown by onBatchStart without touching the batch',
      async () => {
        const { topId } = await seedAttachedTree('/bp-self-cb-err', 3);
        const error = new Error('onBatchStart failed');
        const { onBatchStart, getCalls } = throwingOnBatchStart(error);

        await expect(
          crowi.pageService.updateDescendantCountOfSelfAndDescendants(
            '/bp-self-cb-err',
            onBatchStart,
          ),
        ).rejects.toBe(error);

        expect(getCalls()).toBe(1);
        expect((await Page.findById(topId))?.descendantCount).toBe(9999);
      },
      HANG_TIMEOUT_MS,
    );

    it(
      'rejects with a DB error raised inside a batch',
      async () => {
        await seedAttachedTree('/bp-self-db-err', 3);
        const error = new Error('recount failed');
        vi.spyOn(Page, 'recountDescendantCount').mockRejectedValueOnce(error);

        await expect(
          crowi.pageService.updateDescendantCountOfSelfAndDescendants(
            '/bp-self-db-err',
          ),
        ).rejects.toBe(error);
      },
      HANG_TIMEOUT_MS,
    );
  });

  describe('updateDescendantCountOfPagesWithPaths', () => {
    it(
      'calls onBatchStart once per batch and still recounts every page',
      async () => {
        const nChildren = RECOUNT_WRAPPER_BATCH_SIZE + 50;
        const { topId, childPaths } = await seedAttachedTree(
          '/bp-paths-ok',
          nChildren,
        );
        const paths = ['/bp-paths-ok', ...childPaths];
        const { onBatchStart, getCalls } = countingOnBatchStart();

        await crowi.pageService.updateDescendantCountOfPagesWithPaths(
          paths,
          onBatchStart,
        );

        expect(getCalls()).toBe(
          Math.ceil(paths.length / RECOUNT_WRAPPER_BATCH_SIZE),
        );
        expect((await Page.findById(topId))?.descendantCount).toBe(nChildren);
      },
      HANG_TIMEOUT_MS,
    );

    it(
      'rejects with the error thrown by onBatchStart without touching the batch',
      async () => {
        const { topId, childPaths } = await seedAttachedTree(
          '/bp-paths-cb-err',
          3,
        );
        const error = new Error('onBatchStart failed');
        const { onBatchStart, getCalls } = throwingOnBatchStart(error);

        await expect(
          crowi.pageService.updateDescendantCountOfPagesWithPaths(
            ['/bp-paths-cb-err', ...childPaths],
            onBatchStart,
          ),
        ).rejects.toBe(error);

        expect(getCalls()).toBe(1);
        expect((await Page.findById(topId))?.descendantCount).toBe(9999);
      },
      HANG_TIMEOUT_MS,
    );

    it(
      'rejects with a DB error raised inside a batch',
      async () => {
        const { childPaths } = await seedAttachedTree('/bp-paths-db-err', 3);
        const error = new Error('recount failed');
        vi.spyOn(Page, 'recountDescendantCount').mockRejectedValueOnce(error);

        await expect(
          crowi.pageService.updateDescendantCountOfPagesWithPaths([
            '/bp-paths-db-err',
            ...childPaths,
          ]),
        ).rejects.toBe(error);
      },
      HANG_TIMEOUT_MS,
    );
  });

  describe('recountAndUpdateDescendantCountOfPages', () => {
    // Built the same way as the production callers (deepest path first).
    const cursorUnder = (top: string) =>
      new Page.PageQueryBuilder(Page.find(), true)
        .addConditionToListWithDescendants(top)
        .addConditionToSortPagesByDescPath()
        .query.lean()
        .cursor();

    it(
      'calls onBatchStart once per batch of the given size',
      async () => {
        const { topId } = await seedAttachedTree('/bp-recount-ok', 4);
        const { onBatchStart, getCalls } = countingOnBatchStart();

        // 5 pages in batches of 2
        await crowi.pageService.recountAndUpdateDescendantCountOfPages(
          cursorUnder('/bp-recount-ok'),
          2,
          onBatchStart,
        );

        expect(getCalls()).toBe(3);
        expect((await Page.findById(topId))?.descendantCount).toBe(4);
      },
      HANG_TIMEOUT_MS,
    );

    it(
      'rejects with the error thrown by onBatchStart without touching the batch',
      async () => {
        const { topId } = await seedAttachedTree('/bp-recount-cb-err', 1);
        const error = new Error('onBatchStart failed');
        const { onBatchStart, getCalls } = throwingOnBatchStart(error);

        await expect(
          crowi.pageService.recountAndUpdateDescendantCountOfPages(
            cursorUnder('/bp-recount-cb-err'),
            10,
            onBatchStart,
          ),
        ).rejects.toBe(error);

        expect(getCalls()).toBe(1);
        expect((await Page.findById(topId))?.descendantCount).toBe(9999);
      },
      HANG_TIMEOUT_MS,
    );

    it(
      'rejects with a DB error raised inside a batch',
      async () => {
        await seedAttachedTree('/bp-recount-db-err', 1);
        const error = new Error('findByIdAndUpdate failed');
        vi.spyOn(Page, 'findByIdAndUpdate').mockImplementationOnce(() => {
          throw error;
        });

        await expect(
          crowi.pageService.recountAndUpdateDescendantCountOfPages(
            cursorUnder('/bp-recount-db-err'),
            10,
          ),
        ).rejects.toBe(error);
      },
      HANG_TIMEOUT_MS,
    );
  });
});
