/**
 * AttachmentOrphanSweeper — eventual cleanup of ES attachment docs whose parent
 * Page no longer exists in MongoDB.
 *
 * Design constraints:
 * - NO independent trigger.  This sweeper is called exclusively from
 *   `AttachmentReindexBatch` during rebuildIndex.  It has no cron schedule and
 *   does NOT subscribe to pageEvent or any other event bus.
 * - NEVER throws from `sweep()`.  All failures are logged and accumulated into
 *   the returned `{ removed, failed }` counters.
 * - `runSearch` and `runDeleteByPageId` are injected for testability and
 *   ES-version isolation.
 */

import mongoose from 'mongoose';

import type { AttachmentIndexOperations } from '~/features/search-attachments/server/services/attachment-search-delegator-extension';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:search-attachments:orphan-sweeper');

// ---- Public interface -------------------------------------------------------

export interface AttachmentOrphanSweeper {
  sweep(targetIndex: string): Promise<{ removed: number; failed: number }>;
}

// ---- Minimal ES aggregation response types (version-agnostic) ---------------

interface TermsBucket {
  readonly key: string;
  readonly doc_count: number;
}

interface AggregationResult {
  readonly aggregations?: {
    readonly unique_page_ids?: {
      readonly buckets: TermsBucket[];
    };
  };
}

// ---- Implementation ---------------------------------------------------------

/**
 * Concrete implementation of `AttachmentOrphanSweeper`.
 *
 * All ES I/O is performed through two injected callbacks so that the class
 * remains independent of the specific Elasticsearch client version:
 *
 * @param runSearch           — wraps the version-specific `client.search()`
 * @param runDeleteByPageId   — wraps `client.deleteByQuery()` filtered by pageId
 */
class AttachmentOrphanSweeperImpl implements AttachmentOrphanSweeper {
  constructor(
    private readonly runSearch: (
      indexName: string,
      body: unknown,
    ) => Promise<unknown>,
    private readonly runDeleteByPageId: (
      targetIndex: string,
      pageId: string,
    ) => Promise<void>,
  ) {}

  /**
   * Sweeps orphan attachment documents from `targetIndex`.
   *
   * Algorithm:
   * 1. Aggregate all unique `pageId` values stored in `targetIndex`.
   * 2. Query MongoDB to find which of those pageIds do NOT exist in the Page
   *    collection.
   * 3. For each orphan pageId, call `runDeleteByPageId` to remove all matching
   *    ES documents.
   *
   * Never throws — catastrophic failures return `{ removed: 0, failed: 0 }`.
   */
  async sweep(
    targetIndex: string,
  ): Promise<{ removed: number; failed: number }> {
    try {
      // Step 1: Collect all unique pageIds present in the ES index.
      const allPageIds = await this.collectUniquePageIds(targetIndex);

      if (allPageIds.length === 0) {
        logger.debug({ targetIndex }, 'orphan sweep: index has no documents');
        return { removed: 0, failed: 0 };
      }

      // Step 2: Find which pageIds are missing from the Page collection.
      const orphanPageIds = await this.findOrphanPageIds(allPageIds);

      if (orphanPageIds.length === 0) {
        logger.debug(
          { targetIndex, checked: allPageIds.length },
          'orphan sweep: no orphans found',
        );
        return { removed: 0, failed: 0 };
      }

      logger.info(
        { targetIndex, orphanCount: orphanPageIds.length },
        'orphan sweep: deleting docs for orphan pageIds',
      );

      // Step 3: Delete ES docs for each orphan pageId.
      return await this.deleteOrphans(targetIndex, orphanPageIds);
    } catch (err) {
      logger.error(
        { err, targetIndex },
        'orphan sweep: catastrophic failure — returning { removed: 0, failed: 0 }',
      );
      return { removed: 0, failed: 0 };
    }
  }

  // ---- Private helpers -------------------------------------------------------

  /**
   * Runs a terms aggregation against the target index and returns the full list
   * of unique pageId strings found.
   *
   * Uses size=10000 as a practical upper bound; typical GROWI deployments have
   * far fewer distinct pages than this limit.
   */
  private async collectUniquePageIds(targetIndex: string): Promise<string[]> {
    const aggregationBody = {
      size: 0,
      aggs: {
        unique_page_ids: {
          terms: { field: 'pageId', size: 10000 },
        },
      },
    };

    const rawResult = (await this.runSearch(
      targetIndex,
      aggregationBody,
    )) as AggregationResult;

    const buckets = rawResult?.aggregations?.unique_page_ids?.buckets ?? [];
    return buckets.map((b) => b.key);
  }

  /**
   * Queries the MongoDB Page collection and returns only those IDs from
   * `candidateIds` whose corresponding Page document does NOT exist.
   */
  private async findOrphanPageIds(candidateIds: string[]): Promise<string[]> {
    const Page = mongoose.model('Page');
    const existingPages = await Page.find(
      { _id: { $in: candidateIds } },
      '_id',
    ).lean<{ _id: unknown }[]>();

    const existingIds = new Set(existingPages.map((p) => String(p._id)));

    return candidateIds.filter((id) => !existingIds.has(id));
  }

  /**
   * Calls `runDeleteByPageId` for each orphan pageId concurrently and
   * accumulates `removed` / `failed` counts.  Individual failures are logged
   * and skipped so that a single deletion failure does not abort the remaining
   * cleanup.  Uses `Promise.allSettled` to avoid `await` inside a loop.
   */
  private async deleteOrphans(
    targetIndex: string,
    orphanPageIds: string[],
  ): Promise<{ removed: number; failed: number }> {
    const results = await Promise.allSettled(
      orphanPageIds.map((pageId) =>
        this.runDeleteByPageId(targetIndex, pageId),
      ),
    );

    let removed = 0;
    let failed = 0;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        removed += 1;
      } else {
        logger.warn(
          { err: result.reason, targetIndex, pageId: orphanPageIds[i] },
          'orphan sweep: delete for orphan pageId failed',
        );
        failed += 1;
      }
    }

    return { removed, failed };
  }
}

// ---- Factory ----------------------------------------------------------------

/**
 * Creates an `AttachmentOrphanSweeper`.
 *
 * The `delegatorExt` parameter is accepted here (rather than inside the class)
 * so callers have a single point to pass all dependencies.  The impl itself
 * does not retain a reference to it — all ES I/O goes through `runSearch` and
 * `runDeleteByPageId` callbacks that callers build from the delegator.
 *
 * @param _delegatorExt      — accepted for API symmetry; callers build the
 *                             two callbacks from it before calling this factory
 * @param runSearch          — ES search callback (version-agnostic)
 * @param runDeleteByPageId  — ES deleteByQuery callback filtered by pageId
 */
export const createAttachmentOrphanSweeper = (
  _delegatorExt: AttachmentIndexOperations,
  runSearch: (indexName: string, body: unknown) => Promise<unknown>,
  runDeleteByPageId: (targetIndex: string, pageId: string) => Promise<void>,
): AttachmentOrphanSweeper =>
  new AttachmentOrphanSweeperImpl(runSearch, runDeleteByPageId);
