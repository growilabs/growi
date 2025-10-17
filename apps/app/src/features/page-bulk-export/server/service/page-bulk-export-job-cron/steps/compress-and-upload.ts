import type { Archiver } from 'archiver';
import archiver from 'archiver';

import { PageBulkExportJobStatus } from '~/features/page-bulk-export/interfaces/page-bulk-export';
import { SupportedAction } from '~/interfaces/activity';
import { AttachmentType } from '~/server/interfaces/attachment';
import type { IAttachmentDocument } from '~/server/models/attachment';
import { Attachment } from '~/server/models/attachment';
import type { FileUploader } from '~/server/service/file-uploader';
import loggerFactory from '~/utils/logger';
import type { PageBulkExportJobDocument } from '../../../models/page-bulk-export-job';
import type { IPageBulkExportJobCronService } from '..';

const logger = loggerFactory(
  'growi:service:page-bulk-export-job-cron:compress-and-upload-async',
);

function setUpPageArchiver(): Archiver {
  const pageArchiver = archiver('tar', {
    gzip: true,
  });

  // good practice to catch warnings (ie stat failures and other non-blocking errors)
  pageArchiver.on('warning', (err) => {
    if (err.code === 'ENOENT') logger.error(err);
    else throw err;
  });

  return pageArchiver;
}

async function postProcess(
  this: IPageBulkExportJobCronService,
  pageBulkExportJob: PageBulkExportJobDocument,
  attachment: IAttachmentDocument,
  fileSize: number,
): Promise<void> {
  attachment.fileSize = fileSize;
  await attachment.save();

  pageBulkExportJob.completedAt = new Date();
  pageBulkExportJob.attachment = attachment._id;
  pageBulkExportJob.status = PageBulkExportJobStatus.completed;
  await pageBulkExportJob.save();

  this.removeStreamInExecution(pageBulkExportJob._id);
  await this.notifyExportResultAndCleanUp(
    SupportedAction.ACTION_PAGE_BULK_EXPORT_COMPLETED,
    pageBulkExportJob,
  );
}

/**
 * Execute a pipeline that reads the page files from the temporal fs directory, compresses them, and uploads to the cloud storage
 */
export async function compressAndUpload(
  this: IPageBulkExportJobCronService,
  user,
  pageBulkExportJob: PageBulkExportJobDocument,
): Promise<void> {
  const pageArchiver = setUpPageArchiver();

  if (pageBulkExportJob.revisionListHash == null)
    throw new Error('revisionListHash is not set');
  const originalName = `${pageBulkExportJob.revisionListHash}.${this.compressExtension}`;
  const attachment = Attachment.createWithoutSave(
    null,
    user,
    originalName,
    this.compressExtension,
    0,
    AttachmentType.PAGE_BULK_EXPORT,
  );

  const fileUploadService: FileUploader = this.crowi.fileUploadService;

  pageArchiver.directory(this.getTmpOutputDir(pageBulkExportJob), false);
  pageArchiver.finalize();
  this.setStreamInExecution(pageBulkExportJob._id, pageArchiver);

  try {
    await fileUploadService.uploadAttachment(pageArchiver, attachment);
  } catch (e) {
    logger.error(e);
    this.handleError(e, pageBulkExportJob);
  }
  await postProcess.bind(this)(
    pageBulkExportJob,
    attachment,
    pageArchiver.pointer(),
  );
}
