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
  // Only pages that are actually on the tree, matching every other recount path
  // (updateDescendantCountOfSelfAndDescendants et al). A page left unnormalized by
  // a partial v5 migration has `parent: null`, and so do its children — so
  // recountDescendantCount finds nothing under it and would zero out a count that
  // is not ours to touch. Normalizing those pages is the v5 migration's job.
  builder.addConditionAsOnTree();
  // Deepest paths first, so each page is recounted from children whose own counts
  // have already been corrected in this same pass.
  builder.addConditionToSortPagesByDescPath();

  const cursor = builder.query.lean().cursor({ batchSize: BATCH_SIZE });
  await pageService.recountAndUpdateDescendantCountOfPages(cursor, BATCH_SIZE);
};
