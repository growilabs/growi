import { PassThrough } from 'node:stream';
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
 * Compress page files into a tar.gz archive and upload to cloud storage.
 *
 * Wraps archiver output with PassThrough to provide a Node.js native Readable,
 * since archiver uses npm's readable-stream which fails AWS SDK's instanceof check.
 * The Content-Length / Transfer-Encoding issue is resolved by aws/index.ts using
 * the Upload class from @aws-sdk/lib-storage.
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

  // Wrap with Node.js native PassThrough so that AWS SDK recognizes the stream as a native Readable
  const uploadStream = new PassThrough();
  pageArchiver.pipe(uploadStream);

  pageArchiver.on('error', (err) => {
    logger.error({ err }, 'pageArchiver error');
    uploadStream.destroy(err);
  });

  pageArchiver.directory(this.getTmpOutputDir(pageBulkExportJob), false);
  pageArchiver.finalize();

  this.setStreamsInExecution(pageBulkExportJob._id, pageArchiver, uploadStream);

  try {
    await fileUploadService.uploadAttachment(uploadStream, attachment);
    await postProcess.bind(this)(
      pageBulkExportJob,
      attachment,
      pageArchiver.pointer(),
    );
  } catch (e) {
    logger.error(e);
    await this.handleError(e, pageBulkExportJob);
  }
}
