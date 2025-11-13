import type { IUser } from '@growi/core';
import type { Archiver } from 'archiver';
import archiver from 'archiver';
import { AuditLogBulkExportJobStatus } from '~/features/audit-log-bulk-export/interfaces/audit-log-bulk-export';
import { SupportedAction } from '~/interfaces/activity';
import { AttachmentType } from '~/server/interfaces/attachment';
import {
  Attachment,
  type IAttachmentDocument,
} from '~/server/models/attachment';
import type { FileUploader } from '~/server/service/file-uploader';
import loggerFactory from '~/utils/logger';
import type { AuditLogBulkExportJobDocument } from '../../../models/audit-log-bulk-export-job';
import type { IAuditLogBulkExportJobCronService } from '..';

const logger = loggerFactory(
  'growi:service:audit-log-export-job-cron:compress-and-upload-async',
);

function setUpAuditLogArchiver(
  this: IAuditLogBulkExportJobCronService,
): Archiver {
  const auditLogArchiver = archiver(this.compressFormat, {
    zlib: { level: this.compressLevel },
  });

  // good practice to catch warnings (ie stat failures and other non-blocking errors)
  auditLogArchiver.on('warning', (err) => {
    if (err.code === 'ENOENT') logger.error(err);
    else throw err;
  });

  return auditLogArchiver;
}

async function postProcess(
  this: IAuditLogBulkExportJobCronService,
  auditLogBulkExportJob: AuditLogBulkExportJobDocument,
  attachment: IAttachmentDocument,
  fileSize: number,
): Promise<void> {
  attachment.fileSize = fileSize;
  await attachment.save();

  auditLogBulkExportJob.completedAt = new Date();
  auditLogBulkExportJob.attachment = attachment._id;
  auditLogBulkExportJob.status = AuditLogBulkExportJobStatus.completed;
  await auditLogBulkExportJob.save();

  this.removeStreamInExecution(auditLogBulkExportJob._id);
  await this.notifyExportResultAndCleanUp(
    SupportedAction.ACTION_AUDIT_LOG_BULK_EXPORT_COMPLETED,
    auditLogBulkExportJob,
  );
}

/**
 * Execute a pipeline that reads the audit log files from the temporal fs directory,
 * compresses them into a zip file, and uploads to the cloud storage.
 */
export async function compressAndUpload(
  this: IAuditLogBulkExportJobCronService,
  user: IUser,
  job: AuditLogBulkExportJobDocument,
): Promise<void> {
  const auditLogArchiver = setUpAuditLogArchiver.bind(this)();

  if (job.filterHash == null) throw new Error('filterHash is not set');

  const originalName = `audit-logs-${job.filterHash}.zip`;
  const attachment = Attachment.createWithoutSave(
    null,
    user,
    originalName,
    this.compressFormat,
    0,
    AttachmentType.AUDIT_LOG_BULK_EXPORT,
  );
  const fileUploadService: FileUploader = this.crowi.fileUploadService;

  auditLogArchiver.directory(this.getTmpOutputDir(job), false);
  auditLogArchiver.finalize();

  this.setStreamInExecution(job._id, auditLogArchiver);
  try {
    await fileUploadService.uploadAttachment(auditLogArchiver, attachment);
  } catch (e) {
    logger.error(e);
    await this.handleError(e as Error, job);
    return;
  }
  await postProcess.bind(this)(job, attachment, auditLogArchiver.pointer());
}
