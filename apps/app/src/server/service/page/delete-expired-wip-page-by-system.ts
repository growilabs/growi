import { loggerFactory } from '@growi/logger';
import type { HydratedDocument } from 'mongoose';

import type { PageDocument } from '~/server/models/page';

import { deletePageCompletelyBySystem } from './delete-page-completely-by-system';
import type { IPageService } from './page-service';

const logger = loggerFactory('growi:services:page:delete-expired-wip');

export const deleteExpiredWipPageBySystem = async (
  pages:
    | AsyncIterable<HydratedDocument<PageDocument>>
    | Iterable<HydratedDocument<PageDocument>>,
  pageService: IPageService,
): Promise<void> => {
  for await (const page of pages) {
    const isLeaf = page.descendantCount === 0;
    if (!isLeaf) {
      logger.warn(
        `Skipping non-leaf expired WIP page: ${page.path} (descendantCount=${page.descendantCount})`,
      );
      continue;
    }

    try {
      await deletePageCompletelyBySystem(page, pageService);
    } catch (err) {
      logger.error(`Failed to delete expired WIP page: ${page.path}`, err);
    }
  }
};
