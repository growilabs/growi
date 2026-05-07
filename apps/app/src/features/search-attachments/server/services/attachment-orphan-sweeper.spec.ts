/**
 * Tests for AttachmentOrphanSweeper (task 6.2).
 *
 * All MongoDB and ES calls are stubbed — no live services required.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AttachmentOrphanSweeper,
  createAttachmentOrphanSweeper,
} from './attachment-orphan-sweeper';

// ---------------------------------------------------------------------------
// Helpers / stubs
// ---------------------------------------------------------------------------

/** Build a minimal AttachmentIndexOperations stub. */
function makeDelegatorExtStub() {
  return {
    createAttachmentIndex: vi.fn(),
    syncAttachmentIndexed: vi.fn(),
    syncAttachmentRemoved: vi.fn(),
    searchAttachmentsBody: vi.fn(),
    searchAttachmentsByPageIdsBody: vi.fn(),
    mgetPagesForPermissionBody: vi.fn(),
    addAllAttachments: vi.fn(),
    initializeAttachmentIndex: vi.fn(),
  };
}

/**
 * Build a `runSearch` stub that returns an ES aggregation response containing
 * the given pageIds as terms buckets.
 */
function makeRunSearch(pageIds: string[]) {
  return vi.fn().mockResolvedValue({
    aggregations: {
      unique_page_ids: {
        buckets: pageIds.map((key) => ({ key, doc_count: 1 })),
      },
    },
  });
}

/** Mongoose model stub — mocks `Page.find(...).lean()` */
function makeMongooseMock(existingIds: string[]) {
  return {
    find: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(existingIds.map((id) => ({ _id: id }))),
    }),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AttachmentOrphanSweeper', () => {
  let delegatorExt: ReturnType<typeof makeDelegatorExtStub>;
  let runDeleteByPageId: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    delegatorExt = makeDelegatorExtStub();
    runDeleteByPageId = vi.fn().mockResolvedValue(undefined);
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. No orphans — empty index
  // -------------------------------------------------------------------------
  describe('sweep — empty index', () => {
    it('returns { removed: 0, failed: 0 } when the index has no documents', async () => {
      const runSearch = makeRunSearch([]); // no pageIds in index

      const sweeper: AttachmentOrphanSweeper = createAttachmentOrphanSweeper(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        delegatorExt as any,
        runSearch,
        runDeleteByPageId,
      );

      const result = await sweeper.sweep('attachments-tmp');

      expect(result).toEqual({ removed: 0, failed: 0 });
      expect(runDeleteByPageId).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 2. No orphans — all pageIds exist in MongoDB
  // -------------------------------------------------------------------------
  describe('sweep — all pages exist', () => {
    it('returns { removed: 0, failed: 0 } when every pageId found in ES exists in MongoDB', async () => {
      const pageIds = ['page1', 'page2', 'page3'];
      const runSearch = makeRunSearch(pageIds);

      // Mock mongoose so all candidate pages are returned as existing
      const { default: mongoose } = await import('mongoose');
      vi.spyOn(mongoose, 'model').mockReturnValue(
        // biome-ignore lint/suspicious/noExplicitAny: mongoose model mock
        makeMongooseMock(pageIds) as any,
      );

      const sweeper = createAttachmentOrphanSweeper(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        delegatorExt as any,
        runSearch,
        runDeleteByPageId,
      );

      const result = await sweeper.sweep('attachments-tmp');

      expect(result).toEqual({ removed: 0, failed: 0 });
      expect(runDeleteByPageId).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 3. Orphans found — delete succeeds
  // -------------------------------------------------------------------------
  describe('sweep — orphan pageIds found', () => {
    it('calls runDeleteByPageId for each orphan and returns correct removed count', async () => {
      const allPageIds = ['page1', 'page2', 'page3'];
      // page1 and page3 exist; page2 is an orphan
      const existingIds = ['page1', 'page3'];
      const runSearch = makeRunSearch(allPageIds);

      const { default: mongoose } = await import('mongoose');
      vi.spyOn(mongoose, 'model').mockReturnValue(
        // biome-ignore lint/suspicious/noExplicitAny: mongoose model mock
        makeMongooseMock(existingIds) as any,
      );

      const sweeper = createAttachmentOrphanSweeper(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        delegatorExt as any,
        runSearch,
        runDeleteByPageId,
      );

      const result = await sweeper.sweep('attachments-tmp');

      expect(result).toEqual({ removed: 1, failed: 0 });
      expect(runDeleteByPageId).toHaveBeenCalledOnce();
      expect(runDeleteByPageId).toHaveBeenCalledWith(
        'attachments-tmp',
        'page2',
      );
    });

    it('calls runDeleteByPageId for every orphan when multiple orphans exist', async () => {
      const allPageIds = ['page1', 'page2', 'page3'];
      const runSearch = makeRunSearch(allPageIds);

      // No pages exist → all three are orphans
      const { default: mongoose } = await import('mongoose');
      vi.spyOn(mongoose, 'model').mockReturnValue(
        // biome-ignore lint/suspicious/noExplicitAny: mongoose model mock
        makeMongooseMock([]) as any,
      );

      const sweeper = createAttachmentOrphanSweeper(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        delegatorExt as any,
        runSearch,
        runDeleteByPageId,
      );

      const result = await sweeper.sweep('attachments-tmp');

      expect(result).toEqual({ removed: 3, failed: 0 });
      expect(runDeleteByPageId).toHaveBeenCalledTimes(3);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Partial delete failure
  // -------------------------------------------------------------------------
  describe('sweep — partial delete failure', () => {
    it('accumulates failed count without throwing when some deletes fail', async () => {
      const allPageIds = ['orphan1', 'orphan2', 'orphan3'];
      const runSearch = makeRunSearch(allPageIds);

      // No pages exist → all are orphans
      const { default: mongoose } = await import('mongoose');
      vi.spyOn(mongoose, 'model').mockReturnValue(
        // biome-ignore lint/suspicious/noExplicitAny: mongoose model mock
        makeMongooseMock([]) as any,
      );

      // Second delete fails
      runDeleteByPageId
        .mockResolvedValueOnce(undefined) // orphan1 succeeds
        .mockRejectedValueOnce(new Error('ES timeout')) // orphan2 fails
        .mockResolvedValueOnce(undefined); // orphan3 succeeds

      const sweeper = createAttachmentOrphanSweeper(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        delegatorExt as any,
        runSearch,
        runDeleteByPageId,
      );

      const result = await sweeper.sweep('attachments-tmp');

      expect(result).toEqual({ removed: 2, failed: 1 });
      // Must not throw
    });
  });

  // -------------------------------------------------------------------------
  // 5. Catastrophic failure — sweep never throws
  // -------------------------------------------------------------------------
  describe('sweep — catastrophic failure', () => {
    it('returns { removed: 0, failed: 0 } when runSearch throws', async () => {
      const runSearch = vi.fn().mockRejectedValue(new Error('ES unreachable'));

      const sweeper = createAttachmentOrphanSweeper(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        delegatorExt as any,
        runSearch,
        runDeleteByPageId,
      );

      const result = await sweeper.sweep('attachments-tmp');

      expect(result).toEqual({ removed: 0, failed: 0 });
    });

    it('returns { removed: 0, failed: 0 } when mongoose.model throws', async () => {
      const allPageIds = ['page1'];
      const runSearch = makeRunSearch(allPageIds);

      const { default: mongoose } = await import('mongoose');
      vi.spyOn(mongoose, 'model').mockImplementation(() => {
        throw new Error('MongoDB disconnected');
      });

      const sweeper = createAttachmentOrphanSweeper(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        delegatorExt as any,
        runSearch,
        runDeleteByPageId,
      );

      const result = await sweeper.sweep('attachments-tmp');

      expect(result).toEqual({ removed: 0, failed: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // 6. No independent trigger
  // -------------------------------------------------------------------------
  describe('no independent trigger', () => {
    it('exports only sweep() — no cron, no event listener, no setInterval', () => {
      const runSearch = makeRunSearch([]);

      const sweeper = createAttachmentOrphanSweeper(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        delegatorExt as any,
        runSearch,
        runDeleteByPageId,
      );

      // The public interface must expose exactly one method: sweep
      const publicKeys = Object.getOwnPropertyNames(
        Object.getPrototypeOf(sweeper),
      ).filter((k) => k !== 'constructor');

      expect(publicKeys).toContain('sweep');
      // There must be no scheduling methods
      expect(publicKeys).not.toContain('start');
      expect(publicKeys).not.toContain('schedule');
      expect(publicKeys).not.toContain('listen');
      expect(publicKeys).not.toContain('subscribe');
      expect(publicKeys).not.toContain('onPageDeleted');
      expect(publicKeys).not.toContain('onPageEvent');
    });
  });
});
