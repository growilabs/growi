import type { IUser } from '@growi/core';
import { SupportedAction } from '~/interfaces/activity';
import type { AuditLogBulkExportJobDocument } from '../../../models/audit-log-bulk-export-job';
import type { IAuditLogBulkExportJobCronService } from '..';
/**
 * Execute a pipeline that reads the audit log files from the temporal fs directory,
 * compresses them into a zip file, and uploads to the cloud storage.
 *
 * TODO: Implement the actual compression and upload logic in a future task.
 * Currently, this function only notifies a successful export completion.
 */
export async function compressAndUpload(
  this: IAuditLogBulkExportJobCronService,
  user: IUser,
  job: AuditLogBulkExportJobDocument,
): Promise<void> {
  await this.notifyExportResultAndCleanUp(
    SupportedAction.ACTION_AUDIT_LOG_BULK_EXPORT_COMPLETED,
    job,
  );
}
