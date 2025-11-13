import { AuditLogBulkExportJobStatus } from '~/features/audit-log-bulk-export/interfaces/audit-log-bulk-export';
import type { AuditLogBulkExportJobDocument } from '../../../models/audit-log-bulk-export-job';
import type { IAuditLogBulkExportJobCronService } from '..';

/**
 * Export audit logs to the file system before compressing and uploading.
 *
 * TODO: Implement the actual export logic in a later task.
 * For now, this function only updates the job status to `uploading`.
 */
export async function exportAuditLogsToFsAsync(
  this: IAuditLogBulkExportJobCronService,
  job: AuditLogBulkExportJobDocument,
): Promise<void> {
  job.status = AuditLogBulkExportJobStatus.uploading;
  await job.save();
}
