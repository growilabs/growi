import { configManager } from '~/server/service/config-manager';
import CronService from '~/server/service/cron';
import loggerFactory from '~/utils/logger';

import { AuditLogExportJobInProgressStatus } from '../../interfaces/audit-log-bulk-export';
import AuditLogExportJob from '../models/audit-log-bulk-export-job';

import { auditLogExportJobCronService } from './audit-log-bulk-export-job-cron';

const logger = loggerFactory(
  'growi:service:check-audit-log-bulk-export-job-in-progress-cron',
);

/**
 * Manages cronjob which checks if AuditLogExportJob in progress exists.
 * If it does, and AuditLogExportJobCronService is not running, start AuditLogExportJobCronService
 */
class CheckAuditLogExportJobInProgressCronService extends CronService {
  override getCronSchedule(): string {
    return configManager.getConfig(
      'app:checkAuditLogExportJobInProgressCronSchedule',
    );
  }

  override async executeJob(): Promise<void> {
    const isAuditLogEnabled = configManager.getConfig('app:auditLogEnabled');
    if (!isAuditLogEnabled) return;

    const auditLogExportJobInProgress = await AuditLogExportJob.findOne({
      $or: Object.values(AuditLogExportJobInProgressStatus).map((status) => ({
        status,
      })),
    });
    const auditLogExportInProgressExists = auditLogExportJobInProgress != null;

    if (
      auditLogExportInProgressExists &&
      !auditLogExportJobCronService?.isJobRunning()
    ) {
      auditLogExportJobCronService?.startCron();
    } else if (!auditLogExportInProgressExists) {
      auditLogExportJobCronService?.stopCron();
    }
  }
}

export const checkAuditLogExportJobInProgressCronService =
  new CheckAuditLogExportJobInProgressCronService(); // singleton instance
