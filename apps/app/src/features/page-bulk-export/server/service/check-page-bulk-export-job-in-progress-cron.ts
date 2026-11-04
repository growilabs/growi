import { configManager } from '~/server/service/config-manager';
import CronService from '~/server/service/cron';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import { PageBulkExportJobInProgressStatus } from '../../interfaces/page-bulk-export';
import { pageBulkExportJobCronService } from './page-bulk-export-job-cron';

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

    const pageBulkExportJobInProgress =
      await prisma.pagebulkexportjobs.findFirst({
        where: {
          status: { in: Object.values(PageBulkExportJobInProgressStatus) },
        },
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
