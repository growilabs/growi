import type { IPage } from '@growi/core';
import mongoose from 'mongoose';

import type { PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import type { IPageService } from '../page-service';

const logger = loggerFactory(
  'growi:service:page:repair-page-tree:recount-all-descendant-counts',
);

const BATCH_SIZE = 200;

/**
 * How often to report progress. The admin UI tells the operator that progress goes to
 * the server log, and this is the long half of the repair — one aggregate per page —
 * so a silent run gives them no way to tell it apart from a hang.
 */
const PROGRESS_LOG_INTERVAL = 1000;

/**
 * Recomputes `descendantCount` for every page from its children.
 *
 * Repairs counts left inflated when pages were removed without application code
 * running — the pre-v8 WIP TTL index did exactly that, deleting a page inside
 * MongoDB while its ancestors kept counting it.
 *
 * This walks the entire collection, so it is an admin-triggered maintenance
 * operation rather than anything scheduled.
 */
export const recountAllDescendantCounts = async (
  pageService: IPageService,
): Promise<void> => {
  const Page = mongoose.model<IPage, PageModel>('Page');
  const { PageQueryBuilder } = Page;

  const buildTargetQuery = () => {
    // includeEmpty: true — empty placeholder pages carry a descendantCount too, and
    // a wrong count on one propagates to every ancestor above it.
    const builder = new PageQueryBuilder(Page.find(), true);
    // As every other recount path does. A page left unnormalized by a partial v5
    // migration has no parent, and neither do its children, so recounting from parent
    // links would find nothing under it and zero its count. That is the v5
    // migration's to fix, not ours.
    builder.addConditionAsOnTree();
    return builder;
  };

  // A second pass over the same conditions, purely to give the progress lines a
  // denominator. Cheap next to the recount itself, which runs an aggregate per page.
  const total = await buildTargetQuery().query.countDocuments();
  logger.info(`Recounting descendantCount of ${total} page(s)`);

  const builder = buildTargetQuery();
  // Deepest paths first, so each page is recounted from children whose own counts
  // have already been corrected in this same pass.
  builder.addConditionToSortPagesByDescPath();

  let scanned = 0;
  const cursor = builder.query
    .lean()
    .cursor({ batchSize: BATCH_SIZE })
    // Counts on read, so it runs a batch or so ahead of the recount downstream —
    // hence "scanned" rather than a claim about what has been written.
    .map((doc) => {
      scanned++;
      if (scanned % PROGRESS_LOG_INTERVAL === 0) {
        logger.info(`Recount progress: ${scanned}/${total} page(s) scanned`);
      }
      return doc;
    });

  await pageService.recountAndUpdateDescendantCountOfPages(cursor, BATCH_SIZE);

  logger.info(`Recount finished: ${scanned} page(s) scanned`);
};
