import { loggerFactory } from '@growi/logger';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';

import { deletePageCompletelyBySystem } from './delete-page-completely-by-system';
import type { IPageService } from './page-service';

const logger = loggerFactory('growi:services:page:delete-expired-wip');

export const deleteExpiredWipPageBySystem = async (
  pages:
    | AsyncIterable<HydratedDocument<PageDocument>>
    | Iterable<HydratedDocument<PageDocument>>,
  pageService: IPageService,
): Promise<void> => {
  const Page = mongoose.model<PageDocument, PageModel>('Page');

  for await (const page of pages) {
    const isLeaf = page.descendantCount === 0;
    if (!isLeaf) {
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
      continue;
    }

    try {
      await deletePageCompletelyBySystem(claimed, pageService);
    } catch (err) {
      logger.error(`Failed to delete expired WIP page: ${page.path}`, err);
    }
  }
};
