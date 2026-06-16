import { AuditLogBulkExportJobInProgressJobStatus } from '~/features/audit-log-bulk-export/interfaces/audit-log-bulk-export';
import AuditLogExportJob from '~/features/audit-log-bulk-export/server/models/audit-log-bulk-export-job';
import { auditLogBulkExportJobCronService } from '~/features/audit-log-bulk-export/server/service/audit-log-bulk-export-job-cron';
import { configManager } from '~/server/service/config-manager';
import CronService from '~/server/service/cron';

/**
 * Manages cronjob which checks if AuditLogExportJob in progress exists.
 * If it does, and AuditLogExportJobCronService is not running, start AuditLogExportJobCronService
 */
class CheckAuditLogBulkExportJobInProgressCronService extends CronService {
  override getCronSchedule(): string {
    return '*/3 * * * *';
  }

  override async executeJob(): Promise<void> {
    const isAuditLogEnabled = configManager.getConfig('app:auditLogEnabled');
    if (!isAuditLogEnabled) return;

    const auditLogExportJobInProgress = await AuditLogExportJob.findOne({
      $or: Object.values(AuditLogBulkExportJobInProgressJobStatus).map(
        (status) => ({
          status,
        }),
      ),
    });
    const auditLogExportInProgressExists = auditLogExportJobInProgress != null;

    if (
      auditLogExportInProgressExists &&
      !auditLogBulkExportJobCronService?.isJobRunning()
    ) {
      auditLogBulkExportJobCronService?.startCron();
    } else if (!auditLogExportInProgressExists) {
      auditLogBulkExportJobCronService?.stopCron();
    }
  }
}

export const checkAuditLogExportJobInProgressCronService =
  new CheckAuditLogBulkExportJobInProgressCronService();
