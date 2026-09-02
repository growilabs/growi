import { getIdForRef, type IPage, type Ref } from '@growi/core';
import mongoose, { type HydratedDocument } from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import type { IPageService } from './page-service';
import { shouldUseV4Process } from './should-use-v4-process';

const logger = loggerFactory('growi:services:page:delete-completely-by-system');

type IPageUnderV5 = Omit<IPage, 'parent'> & { parent: Ref<IPage> };

const _shouldUseV5Process = (page: IPage): page is IPageUnderV5 => {
  return !shouldUseV4Process(page);
};

export const deletePageCompletelyBySystem = async (
  page: HydratedDocument<PageDocument>,
  pageService: IPageService,
): Promise<void> => {
  const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
    'Page',
  );

  const ids = [page._id];
  const paths = [page.path];

  const shouldUseV5Process = _shouldUseV5Process(page);
  try {
    // Deletion first so a caller can retry: with the decrement first, every retry
    // subtracts from the ancestors again and understates descendantCount for good.
    // The mirror case (decrement fails after the page is gone) overstates them
    // instead, which the page tree repair can recount.
    await pageService.deleteCompletelyOperation(ids, paths, null);

    if (shouldUseV5Process) {
      const inc = page.isEmpty
        ? -page.descendantCount
        : -(page.descendantCount + 1);

      await pageService.updateDescendantCountOfAncestors(
        getIdForRef(page.parent),
        inc,
        true,
      );

      // After the decrement: this can remove the parent it targets.
      await Page.removeLeafEmptyPagesRecursively(getIdForRef(page.parent));
    }

    if (!page.isEmpty) {
      pageService.getEventEmitter().emit('deleteCompletely', page);
    }
  } catch (err) {
    logger.error('Error occurred while deleting page and subpages.', err);
    throw err;
  }
};
