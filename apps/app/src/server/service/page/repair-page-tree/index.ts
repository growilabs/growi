import loggerFactory from '~/utils/logger';

import type { IPageService } from '../page-service';
import { recountAllDescendantCounts } from './recount-all-descendant-counts';
import { removeEmptyLeafHierarchies } from './remove-empty-leaf-hierarchies';

const logger = loggerFactory('growi:service:page:repair-page-tree');

export type RepairPageTreeSummary = {
  removedEmptyPages: number;
};

/**
 * Repairs the two kinds of damage left behind when pages were removed without
 * application code running — the pre-v8 WIP TTL index deleted pages inside MongoDB,
 * so ancestors kept counting them and the empty placeholders that only hosted them
 * were orphaned.
 *
 * Both halves walk the whole page collection, which is why this is exposed as an
 * admin-triggered maintenance action rather than a cron or a boot-time step. The
 * one-time migration performs the equivalent repair for the upgrade itself; this is
 * the operator's tool for wikis that need it again later.
 *
 * Removal runs first so the recount walks a smaller tree. This is an efficiency
 * choice, not a correctness one: `recountDescendantCount` already excludes empty
 * pages from the count and the recount is bottom-up, so a placeholder contributes 0
 * whether or not it has been removed yet. (The one-time migration's equivalent
 * ordering IS load-bearing — there the sweep decides which legacy pages count as
 * having descendants.)
 */
export const repairPageTree = async (
  pageService: IPageService,
): Promise<RepairPageTreeSummary> => {
  logger.info('Repairing page tree: removing orphaned empty pages');
  const removedEmptyPages = await removeEmptyLeafHierarchies();

  logger.info('Repairing page tree: recounting descendantCount of all pages');
  await recountAllDescendantCounts(pageService);

  const summary = { removedEmptyPages };
  logger.info(summary, 'Page tree repair finished');

  return summary;
};

export { recountAllDescendantCounts, removeEmptyLeafHierarchies };
