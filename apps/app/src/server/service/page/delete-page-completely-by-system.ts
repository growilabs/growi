import { getIdForRef, type IPage, type Ref } from '@growi/core';
import { loggerFactory } from '@growi/logger';
import mongoose, { type HydratedDocument } from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';

import type { IPageService } from './page-service';
import { shouldUseV4Process } from './should-use-v4-process';

const logger = loggerFactory('growi:services:page');

type IPageUnderV5 = Omit<IPage, 'parent'> & { parent: Ref<IPage> };

const _shouldUseV5Process = (page: IPage): page is IPageUnderV5 => {
  return !shouldUseV4Process(page);
};

export const deletePageCompletelyBySystem = async (
  page: HydratedDocument<PageDocument>,
  pageService: IPageService,
) => {
  const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
    'Page',
  );

  const ids = [page._id];
  const paths = [page.path];

  const shouldUseV5Process = _shouldUseV5Process(page);
  try {
    if (shouldUseV5Process) {
      const inc = page.isEmpty
        ? -page.descendantCount
        : -(page.descendantCount + 1);

      await pageService.updateDescendantCountOfAncestors(
        getIdForRef(page.parent),
        inc,
        true,
      );
    }

    await pageService.deleteCompletelyOperation(ids, paths, null);

    if (shouldUseV5Process) {
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
