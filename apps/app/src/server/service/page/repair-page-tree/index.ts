import loggerFactory from '~/utils/logger';

import type { IPageService } from '../page-service';
import { recountAllDescendantCounts } from './recount-all-descendant-counts';
import { removeEmptyLeafHierarchies } from './remove-empty-leaf-hierarchies';

const logger = loggerFactory('growi:service:page:repair-page-tree');

export type RepairPageTreeSummary = {
  removedEmptyPages: number;
};

/**
 * Guards against overlapping runs. The admin UI disables its button once started,
 * but that state is per-browser and resets on reload, so the server cannot rely on
 * it. Two concurrent runs would not corrupt anything (both halves are idempotent)
 * — they would just double the load of an already collection-wide scan.
 *
 * Process-local by design: this is a load guard, not a distributed lock. Repair is
 * an operator action taken in maintenance mode, so a second instance being able to
 * start its own run is acceptable.
 */
let isRunning = false;

export const isRepairPageTreeRunning = (): boolean => isRunning;

/**
 * Repairs the two kinds of damage left behind when pages were removed without
 * application code running — the pre-v8 WIP TTL index deleted pages inside MongoDB,
 * so ancestors kept counting them and the empty placeholders that only hosted them
 * were orphaned.
 *
 * Both halves walk the whole page collection, which is why this is exposed as an
 * admin-triggered maintenance action rather than a cron or a boot-time step. The
 * ttlTimestamp -> wipExpiredAt migration leaves the damage in place for the same
 * reason and logs a pointer here, so this is the only thing that repairs it.
 *
 * Removal runs first so the recount walks a smaller tree. This is an efficiency
 * choice, not a correctness one: `recountDescendantCount` already excludes empty
 * pages from the count and the recount is bottom-up, so a placeholder contributes 0
 * whether or not it has been removed yet.
 *
 * @throws if a repair is already running in this process (see isRunning)
 */
export const repairPageTree = async (
  pageService: IPageService,
): Promise<RepairPageTreeSummary> => {
  if (isRunning) {
    throw new Error('Page tree repair is already running');
  }
  isRunning = true;

  try {
    logger.info('Repairing page tree: removing orphaned empty pages');
    const removedEmptyPages = await removeEmptyLeafHierarchies();

    logger.info('Repairing page tree: recounting descendantCount of all pages');
    await recountAllDescendantCounts(pageService);

    const summary = { removedEmptyPages };
    logger.info(summary, 'Page tree repair finished');

    return summary;
  } finally {
    isRunning = false;
  }
};
