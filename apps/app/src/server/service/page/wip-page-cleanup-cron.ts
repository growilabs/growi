import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import CronService from '~/server/service/cron';
import { randomSleep } from '~/server/util/random-sleep';
import loggerFactory from '~/utils/logger';

import {
  deleteExpiredWipPageBySystem,
  type ExpiredWipPageCandidate,
} from './delete-expired-wip-page-by-system';

const logger = loggerFactory('growi:service:wip-page-cleanup-cron');

// setupCron() runs on every app instance and they share one schedule, so jitter
// de-synchronizes the sweep across pods instead of having them all hit the DB at the
// same instant. It is a load-spreading measure only — correctness under overlap
// comes from the atomic claim in deleteExpiredWipPageBySystem, not from this.
const MAX_RANDOM_SLEEP_MS = 5 * 60 * 1000;

/**
 * Deletes WIP pages whose expiry has passed.
 *
 * WIP expiry used to be enforced by a MongoDB TTL index, which removed the page
 * without running any application code — leaving ancestors' `descendantCount`
 * inflated and empty placeholder pages orphaned. Expiry is now application
 * driven: this cron selects expired pages and deletes them through the normal
 * service path, so counts and empty ancestors are maintained by the deletion.
 *
 * Instantiated by startWipPageCleanupCronIfEnabled, which owns the enabled check.
 */
export class WipPageCleanupCronService extends CronService {
  crowi: Crowi;

  constructor(crowi: Crowi) {
    super();
    this.crowi = crowi;
  }

  override getCronSchedule(): string {
    // `?? ''` only satisfies the non-nullable return type: this service is
    // constructed solely by startWipPageCleanupCronIfEnabled, after it has
    // confirmed a non-empty schedule.
    return configManager.getConfig('app:wipPageCleanupCronSchedule') ?? '';
  }

  override async executeJob(): Promise<void> {
    await randomSleep(MAX_RANDOM_SLEEP_MS);

    const Page = mongoose.model<PageDocument, PageModel>('Page');

    // Streamed and projected, not materialized: the result set is unbounded in
    // principle, and the sweep only needs to identify each candidate — the
    // deletion works from the document its own claim returns.
    //
    // A WIP page that gains a descendant has its wipExpiredAt cleared
    // (updateDescendantCountOfAncestors), so an expired page with children should
    // not exist. Filtering here keeps the sweep cheap; the equivalent checks in
    // deleteExpiredWipPageBySystem are the safety net if the invariant is ever broken.
    const pages = Page.find({
      wip: true,
      wipExpiredAt: { $lte: new Date() },
      descendantCount: 0,
    })
      .select({ _id: 1, path: 1, descendantCount: 1 })
      .lean<ExpiredWipPageCandidate>()
      .cursor();

    const summary = await deleteExpiredWipPageBySystem(
      pages,
      this.crowi.pageService,
    );

    logger.info(summary, 'Expired WIP page cleanup finished');
  }
}

/**
 * Start the cleanup cron IFF `app:wipPageCleanupCronSchedule` is non-empty. Called
 * from Crowi#setupCron at boot.
 *
 * The schedule defaults to a daily expression, so the sweep is on by default;
 * setting the env var to an empty string opts out, which an operator needs when the
 * sweep is too heavy for their wiki or has to be run out-of-band. An invalid
 * expression is logged and skipped rather than allowed to break the boot — WIP
 * pages lingering is preferable to a server that will not start.
 */
export const startWipPageCleanupCronIfEnabled = (crowi: Crowi): void => {
  const schedule = configManager.getConfig('app:wipPageCleanupCronSchedule');
  if (schedule == null || schedule.trim() === '') {
    logger.info('Expired WIP page cleanup is disabled by configuration');
    return;
  }

  try {
    new WipPageCleanupCronService(crowi).startCron();
    logger.info(`Scheduled the expired WIP page cleanup (cron: '${schedule}')`);
  } catch (err) {
    logger.error(
      `Failed to schedule the expired WIP page cleanup (cron: '${schedule}')`,
      err,
    );
  }
};
