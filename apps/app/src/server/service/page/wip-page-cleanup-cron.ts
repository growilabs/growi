import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import CronService from '~/server/service/cron';
import { randomSleep } from '~/server/util/random-sleep';
import loggerFactory from '~/utils/logger';

import { deleteExpiredWipPageBySystem } from './delete-expired-wip-page-by-system';

const logger = loggerFactory('growi:service:wip-page-cleanup-cron');

const CRON_SCHEDULE = '0 3 * * *';

// setupCron() runs on every app instance; jitter de-synchronizes the sweep across
// pods so they don't all hit the DB at 03:00. It is a load-spreading measure only —
// correctness under overlap comes from the atomic claim in
// deleteExpiredWipPageBySystem, not from this.
const MAX_RANDOM_SLEEP_MS = 5 * 60 * 1000;

/**
 * Deletes WIP pages whose expiry has passed.
 *
 * WIP expiry used to be enforced by a MongoDB TTL index, which removed the page
 * without running any application code — leaving ancestors' `descendantCount`
 * inflated and empty placeholder pages orphaned. Expiry is now application
 * driven: this cron selects expired pages and deletes them through the normal
 * service path, so counts and empty ancestors are maintained by the deletion.
 */
export class WipPageCleanupCronService extends CronService {
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

    const Page = mongoose.model<PageDocument, PageModel>('Page');

    // Streamed, not materialized: the result set is unbounded in principle and
    // hydrated documents cost ~3.7 KiB of wrapper each.
    //
    // A WIP page that gains a descendant has its wipExpiredAt cleared
    // (updateDescendantCountOfAncestors), so an expired page with children should
    // not exist. Filtering here keeps the sweep cheap; the equivalent check in
    // deleteExpiredWipPageBySystem is the safety net if the invariant is ever broken.
    const pages = Page.find({
      wip: true,
      wipExpiredAt: { $lte: new Date() },
      descendantCount: 0,
    }).cursor();

    const summary = await deleteExpiredWipPageBySystem(
      pages,
      this.crowi.pageService,
    );

    logger.info(summary, 'Expired WIP page cleanup finished');
  }
}
