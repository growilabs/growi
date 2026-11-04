import { PassThrough } from 'node:stream';
import type { Archiver } from 'archiver';
import archiver from 'archiver';

import { PageBulkExportJobStatus } from '~/features/page-bulk-export/interfaces/page-bulk-export';
import type { pagebulkexportjobs } from '~/generated/prisma/client';
import { SupportedAction } from '~/interfaces/activity';
import { AttachmentType } from '~/server/interfaces/attachment';
import type { AttachmentDraft } from '~/server/models/attachment';
import type { FileUploader } from '~/server/service/file-uploader';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

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
  pageBulkExportJob: pagebulkexportjobs,
  draft: AttachmentDraft,
  fileSize: number,
): Promise<void> {
  const attachment = await prisma.attachments.create({
    data: { ...draft, fileSize },
  });

  const updated = await prisma.pagebulkexportjobs.update({
    where: { id: pageBulkExportJob.id },
    data: {
      completedAt: new Date(),
      attachmentId: attachment.id,
      status: PageBulkExportJobStatus.completed,
    },
  });

  this.removeStreamInExecution(updated.id);
  await this.notifyExportResultAndCleanUp(
    SupportedAction.ACTION_PAGE_BULK_EXPORT_COMPLETED,
    updated,
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
  pageBulkExportJob: pagebulkexportjobs,
): Promise<void> {
  const pageArchiver = setUpPageArchiver();

  if (pageBulkExportJob.revisionListHash == null)
    throw new Error('revisionListHash is not set');
  const originalName = `${pageBulkExportJob.revisionListHash}.${this.compressExtension}`;
  const draft = prisma.attachments.createWithoutSave(
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

  this.setStreamsInExecution(pageBulkExportJob.id, pageArchiver, uploadStream);

  try {
    await fileUploadService.uploadAttachment(uploadStream, draft);
    await postProcess.bind(this)(
      pageBulkExportJob,
      draft,
      pageArchiver.pointer(),
    );
  } catch (e) {
    logger.error(e);
    await this.handleError(e, pageBulkExportJob);
  }
}
