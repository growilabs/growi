import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import CronService from '~/server/service/cron';
import { randomSleep } from '~/server/util/random-sleep';
import loggerFactory from '~/utils/logger';

import { deleteExpiredWipPageBySystem } from './delete-expired-wip-page-by-system';

const logger = loggerFactory('growi:service:page-cleanup-cron');

const CRON_SCHEDULE = '0 3 * * *';

// setupCron() runs on every app instance; jitter de-synchronizes the whole-tree
// scan across pods so they don't all hit the DB at 03:00. The work is idempotent.
const MAX_RANDOM_SLEEP_MS = 5 * 60 * 1000;

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

    try {
      const Page = mongoose.model<PageDocument, PageModel>('Page');
      const pages = Page.find({
        wip: true,
        wipExpiredAt: { $lte: new Date() },
        descendantCount: 0,
      }).cursor();

      await deleteExpiredWipPageBySystem(pages, this.crowi.pageService);
    } catch (err) {
      logger.error('Page cleanup failed.', err);
    }
  }
}
