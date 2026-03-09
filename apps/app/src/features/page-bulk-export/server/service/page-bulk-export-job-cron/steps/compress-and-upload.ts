import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
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
 * Uses a temporary file instead of streaming directly to avoid two issues with AWS S3:
 * 1. archiver's readable-stream (npm) fails AWS SDK's `instanceof Readable` check against Node.js built-in stream
 * 2. PutObjectCommand sends `Transfer-Encoding: chunked` for streams without Content-Length, which S3 rejects with 501
 *
 * Writing to a temp file and using createReadStream resolves both:
 * - createReadStream returns a native ReadStream (passes instanceof check)
 * - AWS SDK auto-detects file size from ReadStream.path via lstatSync, setting Content-Length
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
  // Place temp file in the parent directory to avoid archiver picking it up
  // (archiver.directory() scans getTmpOutputDir asynchronously via glob)
  const tmpFilePath = path.join(
    this.getTmpOutputDir(pageBulkExportJob),
    '..',
    `${originalName}.tmp`,
  );

  logger.info('starting');

  pageArchiver.on('error', (err) => {
    logger.error('pageArchiver error', err);
    // Do not call pageArchiver.destroy() here: it corrupts internal state
    // while the async queue is still processing, causing uncaught exceptions.
    // The error is propagated via the Promise rejection below.
  });

  pageArchiver.directory(this.getTmpOutputDir(pageBulkExportJob), false);
  pageArchiver.finalize();
  logger.info('finalize called');

  this.setStreamsInExecution(pageBulkExportJob._id, pageArchiver);

  try {
    // Write compressed archive to temp file using .pipe() (not pipeline() which auto-destroys streams)
    await new Promise<void>((resolve, reject) => {
      const writeStream = createWriteStream(tmpFilePath);
      pageArchiver.pipe(writeStream);
      writeStream.on('close', resolve);
      writeStream.on('error', reject);
      pageArchiver.on('error', reject);
    });
    logger.info('archive written to temp file');

    // Get file size for Content-Length
    const stat = await fs.stat(tmpFilePath);
    attachment.fileSize = stat.size;
    logger.info(`temp file size: ${stat.size}`);

    // Upload using createReadStream (native ReadStream with .path property)
    logger.info('starting upload');
    const readStream = createReadStream(tmpFilePath);
    await fileUploadService.uploadAttachment(readStream, attachment);
    logger.info('upload completed, running postProcess');

    await postProcess.bind(this)(pageBulkExportJob, attachment, stat.size);
    logger.info('postProcess completed');
  } catch (e) {
    logger.error('error caught', e);
    await this.handleError(e, pageBulkExportJob);
  } finally {
    logger.info('finally block, cleaning up');
    // Clean up temp file
    await fs.unlink(tmpFilePath).catch(() => {});
  }
}
