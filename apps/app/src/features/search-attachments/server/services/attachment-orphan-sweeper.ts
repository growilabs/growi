import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger';

import type { AttachmentIndexOperations } from './attachment-search-delegator-extension';

const logger = loggerFactory('growi:service:search-attachments:orphan-sweeper');

/**
 * Removes the attachment docs whose parent page no longer exists in MongoDB.
 * Runs only as a step of the index rebuild (AttachmentReindexBatch).
 */
export interface AttachmentOrphanSweeper {
  /** Counts page ids. Never throws: a failure ends the sweep with the counts so far. */
  sweep(targetIndex: string): Promise<{ removed: number; failed: number }>;
}

export type OrphanSweepIndexOperations = Pick<
  AttachmentIndexOperations,
  'listPageIds' | 'removePagesFromIndex'
>;

const findMissingPageIds = async (
  candidateIds: string[],
): Promise<string[]> => {
  const Page = mongoose.model('Page');
  const existingPages = await Page.find(
    { _id: { $in: candidateIds } },
    '_id',
  ).lean<{ _id: unknown }[]>();

  const existingIds = new Set(existingPages.map((p) => String(p._id)));
  return candidateIds.filter((id) => !existingIds.has(id));
};

export const createAttachmentOrphanSweeper = (
  indexOperations: OrphanSweepIndexOperations,
): AttachmentOrphanSweeper => ({
  async sweep(targetIndex) {
    let removed = 0;
    let failed = 0;

    try {
      let after: string | undefined;
      // One listing at a time, so neither the id list nor the MongoDB query
      // grows with the number of pages that have attachments.
      do {
        const listing = await indexOperations.listPageIds(targetIndex, after);
        after = listing.after;

        const orphanPageIds = await findMissingPageIds(listing.pageIds);
        if (orphanPageIds.length === 0) {
          continue;
        }

        try {
          await indexOperations.removePagesFromIndex(
            orphanPageIds,
            targetIndex,
          );
          removed += orphanPageIds.length;
        } catch (err) {
          logger.warn(
            { err, targetIndex, pageCount: orphanPageIds.length },
            'orphan sweep: removing the docs of missing pages failed',
          );
          failed += orphanPageIds.length;
        }
      } while (after != null);
    } catch (err) {
      logger.error(
        { err, targetIndex, removed, failed },
        'orphan sweep: stopped before the whole index was checked',
      );
    }

    logger.info({ targetIndex, removed, failed }, 'orphan sweep: finished');
    return { removed, failed };
  },
});
