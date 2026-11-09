import { createHash } from 'node:crypto';
import { pipeline, Writable } from 'node:stream';
import type { IPage } from '@growi/core';
import { getIdStringForRef } from '@growi/core';
import mongoose from 'mongoose';

import { PageBulkExportJobStatus } from '~/features/page-bulk-export/interfaces/page-bulk-export';
import type { pagebulkexportjobs } from '~/generated/prisma/client';
import { SupportedAction } from '~/interfaces/activity';
import type { PageDocument, PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type { IPageBulkExportJobCronService } from '..';
import { BulkExportJobStreamDestroyedByCleanupError } from '../errors';

export async function reuseDuplicateExportIfExists(
  this: IPageBulkExportJobCronService,
  pageBulkExportJob: pagebulkexportjobs,
) {
  // Skip jobs whose attachment is gone or whose download has expired: the
  // clean-up cron removes the attachment of expired jobs, so reusing one would
  // complete this job with an attachment that is about to disappear.
  const downloadExpirationSeconds = configManager.getConfig(
    'app:bulkExportDownloadExpirationSeconds',
  );
  const downloadExpirationThreshold = new Date(
    Date.now() - downloadExpirationSeconds * 1000,
  );
  const duplicateExportJob = await prisma.pagebulkexportjobs.findFirst({
    where: {
      attachmentId: { not: null },
      completedAt: { gte: downloadExpirationThreshold },
      userId: pageBulkExportJob.userId,
      pageId: pageBulkExportJob.pageId,
      format: pageBulkExportJob.format,
      status: PageBulkExportJobStatus.completed,
      revisionListHash: pageBulkExportJob.revisionListHash,
    },
  });
  if (duplicateExportJob != null) {
    // if an upload with the exact same contents exists, re-use the same attachment of that upload
    const updated = await prisma.pagebulkexportjobs.update({
      where: { id: pageBulkExportJob.id },
      data: {
        attachmentId: duplicateExportJob.attachmentId,
        status: PageBulkExportJobStatus.completed,
        completedAt: new Date(),
      },
    });

    await this.notifyExportResultAndCleanUp(
      SupportedAction.ACTION_PAGE_BULK_EXPORT_COMPLETED,
      updated,
    );
  }
}

/**
 * Start a pipeline that creates a snapshot for each page that is to be exported in the pageBulkExportJob.
 * 'revisionListHash' is calulated and saved to the pageBulkExportJob at the end of the pipeline.
 */
export async function createPageSnapshotsAsync(
  this: IPageBulkExportJobCronService,
  user,
  pageBulkExportJob: pagebulkexportjobs,
): Promise<void> {
  const Page = mongoose.model<IPage, PageModel>('Page');

  // if the process of creating snapshots was interrupted, delete the snapshots and create from the start
  await prisma.pagebulkexportpagesnapshots.deleteMany({
    where: { pageBulkExportJobId: pageBulkExportJob.id },
  });

  const basePage = await Page.findById(pageBulkExportJob.pageId);
  if (basePage == null) {
    throw new Error('Base page not found');
  }

  const revisionListHash = createHash('sha256');

  // create a Readable for pages to be exported
  const { PageQueryBuilder } = Page;
  const builder = await new PageQueryBuilder(Page.find())
    .addConditionToListWithDescendants(basePage.path)
    .addViewerCondition(user);
  const pagesReadable = builder.query
    .lean()
    .cursor({ batchSize: this.pageBatchSize });

  // create a Writable that creates a snapshot for each page
  const pageSnapshotsWritable = new Writable({
    objectMode: true,
    write: async (page: PageDocument, encoding, callback) => {
      try {
        if (page.revision != null) {
          revisionListHash.update(getIdStringForRef(page.revision));
        }
        await prisma.pagebulkexportpagesnapshots.create({
          data: {
            pageBulkExportJobId: pageBulkExportJob.id,
            path: page.path,
            revisionId:
              page.revision != null ? getIdStringForRef(page.revision) : null,
          },
        });
      } catch (err) {
        callback(err);
        return;
      }
      callback();
    },
    final: async (callback) => {
      try {
        const updated = await prisma.pagebulkexportjobs.update({
          where: { id: pageBulkExportJob.id },
          data: {
            revisionListHash: revisionListHash.digest('hex'),
            status: PageBulkExportJobStatus.exporting,
          },
        });

        await reuseDuplicateExportIfExists.bind(this)(updated);
      } catch (err) {
        callback(err);
        return;
      }
      callback();
    },
  });

  this.setStreamsInExecution(
    pageBulkExportJob.id,
    pagesReadable,
    pageSnapshotsWritable,
  );

  pipeline(pagesReadable, pageSnapshotsWritable, (err) => {
    // prevent overlapping cleanup
    if (!(err instanceof BulkExportJobStreamDestroyedByCleanupError)) {
      this.handleError(err, pageBulkExportJob);
    }
  });
}
