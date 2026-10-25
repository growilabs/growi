import {
  PdfCtrlSyncJobStatus202Status,
  PdfCtrlSyncJobStatusBodyStatus,
  pdfCtrlSyncJobStatus,
} from '@growi/pdf-converter-client';

import type { pagebulkexportjobs } from '~/generated/prisma/client';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import { PageBulkExportJobStatus } from '../../../interfaces/page-bulk-export';
import PageBulkExportPageSnapshot from '../../models/page-bulk-export-page-snapshot';
import { BulkExportJobExpiredError } from './errors';

/**
 * Request PDF converter and start pdf convert for the pageBulkExportJob,
 * or sync pdf convert status if already started.
 *
 * @returns the job, re-read when this call advanced it to the uploading status
 */
export async function requestPdfConverter(
  pageBulkExportJob: pagebulkexportjobs,
): Promise<pagebulkexportjobs> {
  const jobCreatedAt = pageBulkExportJob.createdAt;

  const isGrowiCloud = configManager.getConfig('app:growiCloudUri') != null;
  const appId = configManager.getConfig('app:growiAppIdForCloud');
  if (isGrowiCloud && appId == null) {
    throw new Error('appId is required for bulk export on GROWI.cloud');
  }

  const exportJobExpirationSeconds = configManager.getConfig(
    'app:bulkExportJobExpirationSeconds',
  );
  const bulkExportJobExpirationDate = new Date(
    jobCreatedAt.getTime() + exportJobExpirationSeconds * 1000,
  );
  let pdfConvertStatus: PdfCtrlSyncJobStatusBodyStatus =
    PdfCtrlSyncJobStatusBodyStatus.HTML_EXPORT_IN_PROGRESS;

  const lastExportPagePath = (
    await PageBulkExportPageSnapshot.findOne({
      pageBulkExportJob: pageBulkExportJob.id,
    }).sort({
      path: -1,
    })
  )?.path;
  if (lastExportPagePath == null) {
    throw new Error('lastExportPagePath is missing');
  }

  if (new Date() > bulkExportJobExpirationDate) {
    throw new BulkExportJobExpiredError(pageBulkExportJob);
  }

  try {
    if (pageBulkExportJob.lastExportedPagePath === lastExportPagePath) {
      pdfConvertStatus = PdfCtrlSyncJobStatusBodyStatus.HTML_EXPORT_DONE;
    }

    if (pageBulkExportJob.status === PageBulkExportJobStatus.failed) {
      pdfConvertStatus = PdfCtrlSyncJobStatusBodyStatus.FAILED;
    }

    const res = await pdfCtrlSyncJobStatus(
      {
        appId,
        jobId: pageBulkExportJob.id,
        expirationDate: bulkExportJobExpirationDate.toISOString(),
        status: pdfConvertStatus,
      },
      { baseURL: configManager.getConfig('app:pageBulkExportPdfConverterUri') },
    );

    if (res.data.status === PdfCtrlSyncJobStatus202Status.PDF_EXPORT_DONE) {
      return await prisma.pagebulkexportjobs.update({
        where: { id: pageBulkExportJob.id },
        data: { status: PageBulkExportJobStatus.uploading },
      });
    }
    if (res.data.status === PdfCtrlSyncJobStatus202Status.FAILED) {
      throw new Error('PDF export failed');
    }
  } catch (err) {
    // Only set as failure when host is ready but failed.
    // If host is not ready, the request should be retried on the next cron execution.
    if (!['ENOTFOUND', 'ECONNREFUSED'].includes(err.code)) {
      throw err;
    }
  }

  return pageBulkExportJob;
}
