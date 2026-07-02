import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import CronService from '~/server/service/cron';
import { randomSleep } from '~/server/util/random-sleep';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:page-cleanup-cron');

const CRON_SCHEDULE = '0 3 * * *';

// setupCron() runs on every app instance; jitter de-synchronizes the whole-tree
// scan across pods so they don't all hit the DB at 03:00. The work is idempotent.
const MAX_RANDOM_SLEEP_MS = 5 * 60 * 1000;

// Each pass can expose a new layer of empty leaves, so the loop is unbounded in
// principle; this backstops a data anomaly (e.g. a parent cycle) from spinning forever.
const MAX_EMPTY_CLEANUP_PASSES = 100;

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

  // Shared by the broad discovery pass and the pre-delete re-verification below.
  private async findChildlessEmptyLeafIds(
    match: mongoose.FilterQuery<PageDocument>,
  ): Promise<mongoose.Types.ObjectId[]> {
    const Page = mongoose.model<PageDocument, PageModel>('Page');

    const emptyLeaves = await Page.aggregate<{ _id: mongoose.Types.ObjectId }>([
      { $match: match },
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

    return emptyLeaves.map((p) => p._id);
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
      const candidateIds = await this.findChildlessEmptyLeafIds({
        isEmpty: true,
        path: { $ne: '/' },
      });

      if (candidateIds.length === 0) {
        break;
      }

      // Re-verify childlessness right before deleting: the broad scan above can
      // be stale, and deleting a candidate that has since gained a real child
      // would orphan it. Re-checking the small id set keeps the TOCTOU window tiny.
      const idsToDelete = await this.findChildlessEmptyLeafIds({
        _id: { $in: candidateIds },
        isEmpty: true,
      });

      if (idsToDelete.length === 0) {
        break;
      }

      const res = await Page.deleteMany({ _id: { $in: idsToDelete } });
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
