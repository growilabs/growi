import { configManager } from '~/server/service/config-manager/index.js';
import CronService from '~/server/service/cron.js';
import loggerFactory from '~/utils/logger/index.js';

import { PageBulkExportJobInProgressStatus } from '../../interfaces/page-bulk-export.js';
import PageBulkExportJob from '../models/page-bulk-export-job.js';
import { pageBulkExportJobCronService } from './page-bulk-export-job-cron/index.js';

const logger = loggerFactory(
  'growi:service:check-page-bulk-export-job-in-progress-cron',
);

/**
 * Manages cronjob which checks if PageBulkExportJob in progress exists.
 * If it does, and PageBulkExportJobCronService is not running, start PageBulkExportJobCronService
 */
class CheckPageBulkExportJobInProgressCronService extends CronService {
  override getCronSchedule(): string {
    return configManager.getConfig(
      'app:checkPageBulkExportJobInProgressCronSchedule',
    );
  }

  override async executeJob(): Promise<void> {
    const isBulkExportPagesEnabled = configManager.getConfig(
      'app:isBulkExportPagesEnabled',
    );
    if (!isBulkExportPagesEnabled) return;

    const pageBulkExportJobInProgress = await PageBulkExportJob.findOne({
      $or: Object.values(PageBulkExportJobInProgressStatus).map((status) => ({
        status,
      })),
    });
    const pageBulkExportInProgressExists = pageBulkExportJobInProgress != null;

    if (
      pageBulkExportInProgressExists &&
      !pageBulkExportJobCronService?.isJobRunning()
    ) {
      pageBulkExportJobCronService?.startCron();
    } else if (!pageBulkExportInProgressExists) {
      pageBulkExportJobCronService?.stopCron();
    }
  }
}

export const checkPageBulkExportJobInProgressCronService =
  new CheckPageBulkExportJobInProgressCronService(); // singleton instance
