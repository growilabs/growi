import { createHash } from 'node:crypto';
import { pipeline, Writable } from 'node:stream';
import type { IPage } from '@growi/core';
import { getIdForRef, getIdStringForRef } from '@growi/core';
import mongoose from 'mongoose';

import { PageBulkExportJobStatus } from '~/features/page-bulk-export/interfaces/page-bulk-export';
import { SupportedAction } from '~/interfaces/activity';
import type { PageDocument, PageModel } from '~/server/models/page';
import type { PageBulkExportJobDocument } from '../../../models/page-bulk-export-job';
import PageBulkExportJob from '../../../models/page-bulk-export-job';
import PageBulkExportPageSnapshot from '../../../models/page-bulk-export-page-snapshot';
import type { IPageBulkExportJobCronService } from '..';

async function reuseDuplicateExportIfExists(
  this: IPageBulkExportJobCronService,
  pageBulkExportJob: PageBulkExportJobDocument,
) {
  const duplicateExportJob = await PageBulkExportJob.findOne({
    user: pageBulkExportJob.user,
    page: pageBulkExportJob.page,
    format: pageBulkExportJob.format,
    status: PageBulkExportJobStatus.completed,
    revisionListHash: pageBulkExportJob.revisionListHash,
  });
  if (duplicateExportJob != null) {
    // if an upload with the exact same contents exists, re-use the same attachment of that upload
    pageBulkExportJob.attachment = duplicateExportJob.attachment;
    pageBulkExportJob.status = PageBulkExportJobStatus.completed;
    await pageBulkExportJob.save();

    await this.notifyExportResultAndCleanUp(
      SupportedAction.ACTION_PAGE_BULK_EXPORT_COMPLETED,
      pageBulkExportJob,
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
  pageBulkExportJob: PageBulkExportJobDocument,
): Promise<void> {
  const Page = mongoose.model<IPage, PageModel>('Page');

  // if the process of creating snapshots was interrupted, delete the snapshots and create from the start
  await PageBulkExportPageSnapshot.deleteMany({ pageBulkExportJob });

  const basePage = await Page.findById(getIdForRef(pageBulkExportJob.page));
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
        await PageBulkExportPageSnapshot.create({
          pageBulkExportJob,
          path: page.path,
          revision: page.revision,
        });
      } catch (err) {
        callback(err);
        return;
      }
      callback();
    },
    final: async (callback) => {
      try {
        pageBulkExportJob.revisionListHash = revisionListHash.digest('hex');
        pageBulkExportJob.status = PageBulkExportJobStatus.exporting;
        await pageBulkExportJob.save();

        await reuseDuplicateExportIfExists.bind(this)(pageBulkExportJob);
      } catch (err) {
        callback(err);
        return;
      }
      callback();
    },
  });

  this.setStreamInExecution(pageBulkExportJob._id, pagesReadable);

  pipeline(pagesReadable, pageSnapshotsWritable, (err) => {
    this.handleError(err, pageBulkExportJob);
  });
}
