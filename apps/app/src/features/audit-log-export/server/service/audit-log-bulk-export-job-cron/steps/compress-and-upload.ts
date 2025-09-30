import type { Archiver } from 'archiver';
import archiver from 'archiver';

import { AuditLogExportJobStatus } from '~/features/audit-log-export/interfaces/audit-log-bulk-export';
import { SupportedAction } from '~/interfaces/activity';
import { AttachmentType } from '~/server/interfaces/attachment';
import type { IAttachmentDocument } from '~/server/models/attachment';
import { Attachment } from '~/server/models/attachment';
import type { FileUploader } from '~/server/service/file-uploader';
import loggerFactory from '~/utils/logger';
import type { AuditLogExportJobDocument } from '../../../models/audit-log-bulk-export-job';
import type { IAuditLogExportJobCronService } from '..';

const logger = loggerFactory(
  'growi:service:audit-log-export-job-cron:compress-and-upload-async',
);

function setUpAuditLogArchiver(): Archiver {
  const auditLogArchiver = archiver('zip', {
    zlib: { level: 6 },
  });

  // good practice to catch warnings (ie stat failures and other non-blocking errors)
  auditLogArchiver.on('warning', (err) => {
    if (err.code === 'ENOENT') logger.error(err);
    else throw err;
  });

  return auditLogArchiver;
}

async function postProcess(
  this: IAuditLogExportJobCronService,
  auditLogExportJob: AuditLogExportJobDocument,
  attachment: IAttachmentDocument,
  fileSize: number,
): Promise<void> {
  attachment.fileSize = fileSize;
  await attachment.save();

  auditLogExportJob.completedAt = new Date();
  auditLogExportJob.attachment = attachment._id;
  auditLogExportJob.status = AuditLogExportJobStatus.completed;
  await auditLogExportJob.save();

  this.removeStreamInExecution(auditLogExportJob._id);
  await this.notifyExportResultAndCleanUp(
    SupportedAction.ACTION_AUDIT_LOG_EXPORT_COMPLETED,
    auditLogExportJob,
  );
}

/**
 * Execute a pipeline that reads the audit log files from the temporal fs directory, compresses them into a zip file, and uploads to the cloud storage
 */
export async function compressAndUpload(
  this: IAuditLogExportJobCronService,
  user,
  auditLogExportJob: AuditLogExportJobDocument,
): Promise<void> {
  const auditLogArchiver = setUpAuditLogArchiver();

  if (auditLogExportJob.filterHash == null)
    throw new Error('filterHash is not set');

  const originalName = `audit-logs-${auditLogExportJob.filterHash}.zip`;
  const attachment = Attachment.createWithoutSave(
    null,
    user,
    originalName,
    'zip',
    0,
    AttachmentType.AUDIT_LOG_EXPORT,
  );

  const fileUploadService: FileUploader = this.crowi.fileUploadService;

  auditLogArchiver.directory(this.getTmpOutputDir(auditLogExportJob), false);
  auditLogArchiver.finalize();
  this.setStreamInExecution(auditLogExportJob._id, auditLogArchiver);

  try {
    await fileUploadService.uploadAttachment(auditLogArchiver, attachment);
  } catch (e) {
    logger.error(e);
    this.handleError(e, auditLogExportJob);
  }
  await postProcess.bind(this)(
    auditLogExportJob,
    attachment,
    auditLogArchiver.pointer(),
  );
}
