import type { IPage } from '@growi/core';
import mongoose from 'mongoose';

import type { PageModel } from '~/server/models/page';

import type { IPageService } from '../page-service';

const BATCH_SIZE = 200;

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

  // includeEmpty: true — empty placeholder pages carry a descendantCount too, and
  // a wrong count on one propagates to every ancestor above it.
  const builder = new PageQueryBuilder(Page.find(), true);
  // As every other recount path does. A page left unnormalized by a partial v5
  // migration has no parent, and neither do its children, so recounting from parent
  // links would find nothing under it and zero its count. That is the v5
  // migration's to fix, not ours.
  builder.addConditionAsOnTree();
  // Deepest paths first, so each page is recounted from children whose own counts
  // have already been corrected in this same pass.
  builder.addConditionToSortPagesByDescPath();

  const cursor = builder.query.lean().cursor({ batchSize: BATCH_SIZE });
  await pageService.recountAndUpdateDescendantCountOfPages(cursor, BATCH_SIZE);
};
