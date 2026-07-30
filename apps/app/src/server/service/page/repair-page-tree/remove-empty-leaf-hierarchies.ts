import type { IPage } from '@growi/core';
import mongoose from 'mongoose';

import type { PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:service:page:repair-page-tree:remove-empty-leaf-hierarchies',
);

/**
 * Backstops a data anomaly (e.g. a parent cycle) from spinning forever. Each pass
 * can expose a new layer of empty leaves, so the loop is unbounded in principle.
 */
const MAX_PASSES = 100;

/**
 * Removes empty placeholder pages that no longer connect anything.
 *
 * An empty page is a structural node that exists only to link a real descendant to
 * its ancestors; once childless it serves no purpose. Historically the WIP TTL index
 * deleted pages without running application code, so the placeholders that only
 * hosted them were left orphaned.
 *
 * Deleting one can leave its (also empty) parent childless, so passes repeat until
 * nothing is removed.
 *
 * @returns the number of pages removed
 */
export const removeEmptyLeafHierarchies = async (): Promise<number> => {
  const Page = mongoose.model<IPage, PageModel>('Page');

  let totalRemoved = 0;
  let pass = 0;

  for (; pass < MAX_PASSES; pass++) {
    // biome-ignore lint/performance/noAwaitInLoops: each pass must observe the previous pass's deletions
    const emptyLeaves = await Page.aggregate<{
      _id: mongoose.Types.ObjectId;
    }>([
      { $match: { isEmpty: true, path: { $ne: '/' } } },
      {
        $lookup: {
          from: 'pages',
          localField: '_id',
          foreignField: 'parent',
          pipeline: [{ $limit: 1 }, { $project: { _id: 1 } }],
          as: 'children',
        },
      },
      { $match: { children: { $size: 0 } } },
      { $project: { _id: 1 } },
    ]);

    if (emptyLeaves.length === 0) {
      break;
    }

    const ids = emptyLeaves.map((page) => page._id);

    // Re-verify childlessness at delete time. This runs against a live site (the
    // admin endpoint gates on maintenance mode, but the service does not), so a
    // page could have been created under one of these between the scan above and
    // the delete below — removing its parent would orphan it.
    const idsThatGainedChildren = new Set(
      (await Page.distinct('parent', { parent: { $in: ids } })).map(String),
    );
    const stillChildless = ids.filter(
      (id) => !idsThatGainedChildren.has(String(id)),
    );
    if (stillChildless.length === 0) {
      break;
    }

    // `isEmpty: true` is re-asserted here as well: a placeholder can be filled in
    // by a real page creation (preparePageDocumentToCreate reuses empty pages).
    const res = await Page.deleteMany({
      _id: { $in: stillChildless },
      isEmpty: true,
    });
    totalRemoved += res.deletedCount ?? 0;
  }

  if (pass >= MAX_PASSES) {
    logger.warn(
      `Empty-page cleanup hit the ${MAX_PASSES}-pass cap without converging; some empty pages may remain. Investigate for a possible parent cycle.`,
    );
  }

  return totalRemoved;
};
