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
    // The deletion runs BEFORE the ancestor bookkeeping, so that a caller may
    // retry after a failure. deleteCompletelyOperation is where a failure
    // realistically comes from — it reaches revisions, attachments and the search
    // index — and it is the only step here that is naturally idempotent-ish:
    // nothing has been counted yet, so re-running the whole call is safe. With the
    // decrement first, every retry would subtract from the ancestors again and
    // permanently understate descendantCount.
    //
    // The residual risk is the mirror image: if the decrement below fails after
    // the page is gone, ancestors are left overstated — the TTL-era symptom this
    // PR exists to fix, but recoverable via Admin > App Settings > page tree
    // repair, whereas a double decrement looks like valid data and is not.
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

      // Last: this can remove the parent itself, which the decrement above needs
      // to still be there.
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
