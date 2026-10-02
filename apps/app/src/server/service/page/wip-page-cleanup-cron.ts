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

    // The page tree repair runs in maintenance mode and recounts descendantCount
    // across the collection; deleting pages underneath it races that recount.
    // Skipping is free — the pages stay expired for the next run.
    if (this.crowi.appService.isMaintenanceMode()) {
      logger.info(
        'Skipping the expired WIP page cleanup: GROWI is in maintenance mode',
      );
      return;
    }

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

    // Retried next run, but a page that keeps failing would otherwise surface only
    // as one error line per run.
    if (summary.failed > 0) {
      logger.warn(
        summary,
        `${summary.failed} expired WIP page(s) could not be deleted; their expiry was re-armed for a later sweep`,
      );
    }
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

  // This catch only works because node-cron throws synchronously from schedule(),
  // which ^3.0.2 does — as a validation error for an out-of-range field ("99 * * * *"),
  // as an internal TypeError for a malformed one ("abc"). Verified against 3.0.3; it is
  // not a documented contract, so re-check on a major bump. If throwing ever moves to a
  // callback or event, a bad expression escapes this catch and the "logged and skipped"
  // promise above turns into an unhandled boot crash.
  //
  // Note it is not exhaustive either: a 7-field expression is accepted here and simply
  // never fires. Only an operator reading the boot log would notice.
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
