import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import CronService from '~/server/service/cron';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:page-cleanup-cron');

const CRON_SCHEDULE = '0 3 * * *';

// setupCron() runs on every app instance; jitter de-synchronizes the whole-tree
// scan across pods so they don't all hit the DB at 03:00. The work is idempotent.
const MAX_RANDOM_SLEEP_MS = 5 * 60 * 1000;

// Each pass can expose a new layer of empty leaves, so the loop is unbounded in
// principle; this backstops a data anomaly (e.g. a parent cycle) from spinning forever.
const MAX_EMPTY_CLEANUP_PASSES = 100;

const randomSleep = (maxMs: number): Promise<void> => {
  const ms = Math.floor(Math.random() * maxMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * When the MongoDB TTL index deletes an expired WIP page, no application code
 * runs, so ancestors' `descendantCount` stays too high and the empty placeholder
 * pages that only hosted it are orphaned. This cron periodically re-derives the
 * correct state from the surviving tree (a TTL delete leaves no tombstone to target).
 */
export class PageCleanupCronService extends CronService {
  crowi: Crowi;

  constructor(crowi: Crowi) {
    super();
    this.crowi = crowi;
  }

  override getCronSchedule(): string {
    return CRON_SCHEDULE;
  }

  override async executeJob(): Promise<void> {
    await randomSleep(MAX_RANDOM_SLEEP_MS);

    // Empty pages are excluded from descendantCount, so removing them first only
    // shrinks the recount's work set — it never changes a count.
    await this.removeEmptyLeafHierarchies();
    await this.crowi.pageService.recountAndUpdateDescendantCountOfAllPages();
  }

  /**
   * An empty page is a structural placeholder that only connects a real
   * descendant to its ancestors; once childless it serves no purpose. Deleting
   * one can leave its (also empty) parent childless, so we repeat until a pass
   * removes nothing.
   */
  async removeEmptyLeafHierarchies(): Promise<void> {
    const Page = mongoose.model<PageDocument, PageModel>('Page');

    let totalRemoved = 0;
    let pass = 0;
    for (; pass < MAX_EMPTY_CLEANUP_PASSES; pass++) {
      // biome-ignore lint/performance/noAwaitInLoops: each pass depends on the previous one's deletions
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

      const ids = emptyLeaves.map((p) => p._id);
      const res = await Page.deleteMany({ _id: { $in: ids } });
      totalRemoved += res.deletedCount ?? 0;
    }

    if (pass >= MAX_EMPTY_CLEANUP_PASSES) {
      logger.warn(
        `Empty-page cleanup hit the ${MAX_EMPTY_CLEANUP_PASSES}-pass cap without converging; some empty pages may remain. Investigate for a possible parent cycle.`,
      );
    }
    if (totalRemoved > 0) {
      logger.info(`Removed ${totalRemoved} orphaned empty page(s)`);
    }
  }
}
