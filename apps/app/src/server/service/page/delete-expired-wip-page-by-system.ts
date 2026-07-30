import { loggerFactory } from '@growi/logger';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';

import { deletePageCompletelyBySystem } from './delete-page-completely-by-system';
import type { IPageService } from './page-service';

const logger = loggerFactory('growi:services:page:delete-expired-wip');

export type DeleteExpiredWipPageSummary = {
  deleted: number;
  skippedNonLeaf: number;
  /** Claim lost to another instance, or the page stopped being eligible. */
  skippedNotClaimed: number;
  failed: number;
};

export const deleteExpiredWipPageBySystem = async (
  pages:
    | AsyncIterable<HydratedDocument<PageDocument>>
    | Iterable<HydratedDocument<PageDocument>>,
  pageService: IPageService,
): Promise<DeleteExpiredWipPageSummary> => {
  const Page = mongoose.model<PageDocument, PageModel>('Page');

  let deleted = 0;
  let skippedNonLeaf = 0;
  let skippedNotClaimed = 0;
  let failed = 0;

  for await (const page of pages) {
    const isLeaf = page.descendantCount === 0;
    if (!isLeaf) {
      skippedNonLeaf++;
      logger.warn(
        `Skipping non-leaf expired WIP page: ${page.path} (descendantCount=${page.descendantCount})`,
      );
      continue;
    }

    // findOneAndDelete is the claim: it removes the page row atomically so only one
    // instance proceeds. The Page.deleteMany inside deletePageCompletelyBySystem is
    // then a no-op — the rest of its cascade (revisions, attachments, …) is what we
    // still need.
    const claimed = await Page.findOneAndDelete({
      _id: page._id,
      wip: true,
      wipExpiredAt: { $lte: new Date() },
      descendantCount: 0,
    });
    if (claimed == null) {
      skippedNotClaimed++;
      continue;
    }

    try {
      await deletePageCompletelyBySystem(claimed, pageService);
      deleted++;
    } catch (err) {
      failed++;
      logger.error(`Failed to delete expired WIP page: ${page.path}`, err);
    }
  }

  return { deleted, skippedNonLeaf, skippedNotClaimed, failed };
};
