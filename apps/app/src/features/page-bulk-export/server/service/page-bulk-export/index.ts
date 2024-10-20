import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Writable, pipeline } from 'stream';
import { pipeline as pipelinePromise } from 'stream/promises';


import type { IUser } from '@growi/core';
import {
  getIdForRef, getIdStringForRef, type IPage, isPopulated, SubscriptionStatusType,
} from '@growi/core';
import { getParentPath, normalizePath } from '@growi/core/dist/utils/path-utils';
import { pdfCtrlSyncJobStatus, PdfCtrlSyncJobStatus202Status, PdfCtrlSyncJobStatusBodyStatus } from '@growi/pdf-converter/dist/client-library';
import type { Archiver } from 'archiver';
import archiver from 'archiver';
import gc from 'expose-gc/function';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';
import remark from 'remark';
import html from 'remark-html';

import type { SupportedActionType } from '~/interfaces/activity';
import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import { AttachmentType, FilePathOnStoragePrefix } from '~/server/interfaces/attachment';
import type { ActivityDocument } from '~/server/models/activity';
import type { IAttachmentDocument } from '~/server/models/attachment';
import { Attachment } from '~/server/models/attachment';
import type { PageModel, PageDocument } from '~/server/models/page';
import Subscription from '~/server/models/subscription';
import { configManager } from '~/server/service/config-manager';
import type { FileUploader } from '~/server/service/file-uploader';
import type { IMultipartUploader } from '~/server/service/file-uploader/multipart-uploader';
import { preNotifyService } from '~/server/service/pre-notify';
import { getBufferToFixedSizeTransform } from '~/server/util/stream';
import loggerFactory from '~/utils/logger';

import { PageBulkExportFormat, PageBulkExportJobInProgressStatus, PageBulkExportJobStatus } from '../../../interfaces/page-bulk-export';
import type { PageBulkExportJobDocument } from '../../models/page-bulk-export-job';
import PageBulkExportJob from '../../models/page-bulk-export-job';
import type { PageBulkExportPageSnapshotDocument } from '../../models/page-bulk-export-page-snapshot';
import PageBulkExportPageSnapshot from '../../models/page-bulk-export-page-snapshot';

import { BulkExportJobExpiredError, BulkExportJobRestartedError, DuplicateBulkExportJobError } from './errors';
import { PageBulkExportJobManager } from './page-bulk-export-job-manager';


const logger = loggerFactory('growi:services:PageBulkExportService');

export type ActivityParameters ={
  ip?: string;
  endpoint: string;
}

export interface IPageBulkExportService {
  executePageBulkExportJob: (pageBulkExportJob: HydratedDocument<PageBulkExportJobDocument>, activityParameters?: ActivityParameters) => Promise<void>
}

class PageBulkExportService implements IPageBulkExportService {

  crowi: any;

  activityEvent: any;

  // multipart upload max part size
  maxPartSize = 5 * 1024 * 1024; // 5MB

  pageBatchSize = 100;

  compressExtension = 'tar.gz';

  pageBulkExportJobManager: PageBulkExportJobManager;

  // temporal path of local fs to output page files before upload
  // TODO: If necessary, change to a proper path in https://redmine.weseek.co.jp/issues/149512
  tmpOutputRootDir = '/tmp/page-bulk-export';

  pageModel: PageModel;

  constructor(crowi) {
    this.crowi = crowi;
    this.activityEvent = crowi.event('activity');
    this.pageModel = mongoose.model<IPage, PageModel>('Page');
    this.pageBulkExportJobManager = new PageBulkExportJobManager(this);
  }

  /**
   * Create a new page bulk export job and execute it
   */
  async createAndExecuteOrRestartBulkExportJob(
      basePagePath: string, format: PageBulkExportFormat, currentUser, activityParameters: ActivityParameters, restartJob = false,
  ): Promise<void> {
    const basePage = await this.pageModel.findByPathAndViewer(basePagePath, currentUser, null, true);

    if (basePage == null) {
      throw new Error('Base page not found or not accessible');
    }

    const duplicatePageBulkExportJobInProgress: HydratedDocument<PageBulkExportJobDocument> | null = await PageBulkExportJob.findOne({
      user: currentUser,
      page: basePage,
      format,
      $or: Object.values(PageBulkExportJobInProgressStatus).map(status => ({ status })),
    });
    if (duplicatePageBulkExportJobInProgress != null) {
      if (restartJob) {
        this.restartBulkExportJob(duplicatePageBulkExportJobInProgress, activityParameters);
        return;
      }
      throw new DuplicateBulkExportJobError(duplicatePageBulkExportJobInProgress);
    }
    const pageBulkExportJob: HydratedDocument<PageBulkExportJobDocument> = await PageBulkExportJob.create({
      user: currentUser, page: basePage, format, status: PageBulkExportJobStatus.initializing,
    });

    await Subscription.upsertSubscription(currentUser, SupportedTargetModel.MODEL_PAGE_BULK_EXPORT_JOB, pageBulkExportJob, SubscriptionStatusType.SUBSCRIBE);

    this.pageBulkExportJobManager.addJob(pageBulkExportJob, activityParameters);
  }

  /**
   * Restart page bulk export job in progress from the beginning
   */
  async restartBulkExportJob(pageBulkExportJob: HydratedDocument<PageBulkExportJobDocument>, activityParameters: ActivityParameters): Promise<void> {
    await this.cleanUpExportJobResources(pageBulkExportJob, true);

    pageBulkExportJob.status = PageBulkExportJobStatus.initializing;
    await pageBulkExportJob.save();
    this.pageBulkExportJobManager.addJob(pageBulkExportJob, activityParameters);
  }

  /**
   * Execute a page bulk export job. This method can also resume a previously inturrupted job.
   */
  async executePageBulkExportJob(pageBulkExportJob: HydratedDocument<PageBulkExportJobDocument>, activityParameters?: ActivityParameters): Promise<void> {
    try {
      const User = mongoose.model<IUser>('User');
      const user = await User.findById(getIdForRef(pageBulkExportJob.user));

      if (pageBulkExportJob.status === PageBulkExportJobStatus.initializing) {
        await this.createPageSnapshots(user, pageBulkExportJob);

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
        }
        else {
          pageBulkExportJob.status = PageBulkExportJobStatus.exporting;
        }
        await pageBulkExportJob.save();
      }
      if (pageBulkExportJob.status === PageBulkExportJobStatus.exporting) {
        await this.exportPagesToFS(pageBulkExportJob);
        pageBulkExportJob.status = PageBulkExportJobStatus.uploading;
        await pageBulkExportJob.save();
      }
      if (pageBulkExportJob.status === PageBulkExportJobStatus.uploading) {
        await this.compressAndUpload(user, pageBulkExportJob);
      }
    }
    catch (err) {
      if (err instanceof BulkExportJobExpiredError) {
        logger.error(err);
        await this.notifyExportResultAndCleanUp(SupportedAction.ACTION_PAGE_BULK_EXPORT_JOB_EXPIRED, pageBulkExportJob, activityParameters);
      }
      else if (err instanceof BulkExportJobRestartedError) {
        logger.info(err.message);
        await this.cleanUpExportJobResources(pageBulkExportJob);
      }
      else {
        logger.error(err);
        await this.notifyExportResultAndCleanUp(SupportedAction.ACTION_PAGE_BULK_EXPORT_FAILED, pageBulkExportJob, activityParameters);
      }
      return;
    }

    await this.notifyExportResultAndCleanUp(SupportedAction.ACTION_PAGE_BULK_EXPORT_COMPLETED, pageBulkExportJob, activityParameters);
  }

  /**
   * Notify the user of the export result, and cleanup the resources used in the export process
   * @param action whether the export was successful
   * @param pageBulkExportJob the page bulk export job
   * @param activityParameters parameters to record user activity
   */
  private async notifyExportResultAndCleanUp(
      action: SupportedActionType,
      pageBulkExportJob: PageBulkExportJobDocument,
      activityParameters?: ActivityParameters,
  ): Promise<void> {
    pageBulkExportJob.status = action === SupportedAction.ACTION_PAGE_BULK_EXPORT_COMPLETED
      ? PageBulkExportJobStatus.completed : PageBulkExportJobStatus.failed;

    try {
      await pageBulkExportJob.save();
      await this.notifyExportResult(pageBulkExportJob, action, activityParameters);
    }
    catch (err) {
      logger.error(err);
    }
    // execute independently of notif process resolve/reject
    await this.cleanUpExportJobResources(pageBulkExportJob);
  }

  /**
   * Create a snapshot for each page that is to be exported in the pageBulkExportJob.
   * Also calulate revisionListHash and save it to the pageBulkExportJob.
   */
  private async createPageSnapshots(user, pageBulkExportJob: PageBulkExportJobDocument): Promise<void> {
    // if the process of creating snapshots was interrupted, delete the snapshots and create from the start
    await PageBulkExportPageSnapshot.deleteMany({ pageBulkExportJob });

    const basePage = await this.pageModel.findById(getIdForRef(pageBulkExportJob.page));
    if (basePage == null) {
      throw new Error('Base page not found');
    }

    const revisionListHash = createHash('sha256');

    // create a Readable for pages to be exported
    const { PageQueryBuilder } = this.pageModel;
    const builder = await new PageQueryBuilder(this.pageModel.find())
      .addConditionToListWithDescendants(basePage.path)
      .addViewerCondition(user);
    const pagesReadable = builder
      .query
      .lean()
      .cursor({ batchSize: this.pageBatchSize });

    // create a Writable that creates a snapshot for each page
    const pageSnapshotsWritable = new Writable({
      objectMode: true,
      write: async(page: PageDocument, encoding, callback) => {
        try {
          if (page.revision != null) {
            revisionListHash.update(getIdStringForRef(page.revision));
          }
          await PageBulkExportPageSnapshot.create({
            pageBulkExportJob,
            path: page.path,
            revision: page.revision,
          });
        }
        catch (err) {
          callback(err);
          return;
        }
        callback();
      },
    });

    this.pageBulkExportJobManager.updateJobStream(pageBulkExportJob._id, pagesReadable);

    await pipelinePromise(pagesReadable, pageSnapshotsWritable);

    pageBulkExportJob.revisionListHash = revisionListHash.digest('hex');
    await pageBulkExportJob.save();
  }

  /**
   * Export pages to the file system before compressing and uploading to the cloud storage.
   * The export will resume from the last exported page if the process was interrupted.
   */
  private async exportPagesToFS(pageBulkExportJob: PageBulkExportJobDocument): Promise<void> {
    const findQuery = pageBulkExportJob.lastExportedPagePath != null ? {
      pageBulkExportJob,
      path: { $gt: pageBulkExportJob.lastExportedPagePath },
    } : { pageBulkExportJob };
    const pageSnapshotsReadable = PageBulkExportPageSnapshot
      .find(findQuery)
      .populate('revision').sort({ path: 1 }).lean()
      .cursor({ batchSize: this.pageBatchSize });

    const pagesWritable = this.getPageWritable(pageBulkExportJob);

    this.pageBulkExportJobManager.updateJobStream(pageBulkExportJob._id, pageSnapshotsReadable);

    if (pageBulkExportJob.format === PageBulkExportFormat.pdf) {
      pipeline(pageSnapshotsReadable, pagesWritable, (err) => { if (err != null) logger.error(err); });
      await this.waitPdfExportFinish(pageBulkExportJob);
    }
    else {
      await pipelinePromise(pageSnapshotsReadable, pagesWritable);
    }
  }

  /**
   * Get a Writable that writes the page body temporarily to fs
   */
  private getPageWritable(pageBulkExportJob: PageBulkExportJobDocument): Writable {
    const isHtmlPath = pageBulkExportJob.format === PageBulkExportFormat.pdf;
    const outputDir = this.getTmpOutputDir(pageBulkExportJob, isHtmlPath);
    return new Writable({
      objectMode: true,
      write: async(page: PageBulkExportPageSnapshotDocument, encoding, callback) => {
        try {
          const revision = page.revision;

          if (revision != null && isPopulated(revision)) {
            const markdownBody = revision.body;
            const format = pageBulkExportJob.format === PageBulkExportFormat.pdf ? 'html' : pageBulkExportJob.format;
            const pathNormalized = `${normalizePath(page.path)}.${format}`;
            const fileOutputPath = path.join(outputDir, pathNormalized);
            const fileOutputParentPath = getParentPath(fileOutputPath);
            await fs.promises.mkdir(fileOutputParentPath, { recursive: true });

            if (pageBulkExportJob.format === PageBulkExportFormat.md) {
              await fs.promises.writeFile(fileOutputPath, markdownBody);
            }
            else {
              const htmlString = await this.convertMdToHtml(markdownBody);
              await fs.promises.writeFile(fileOutputPath, htmlString);
            }
            pageBulkExportJob.lastExportedPagePath = page.path;
            await pageBulkExportJob.save();
          }
        }
        catch (err) {
          callback(err);
          // update status to notify failure and report to pdf converter in waitPdfExportFinish
          pageBulkExportJob.status = PageBulkExportJobStatus.failed;
          await pageBulkExportJob.save();
          return;
        }
        callback();
      },
    });
  }

  private async convertMdToHtml(md: string): Promise<string> {
    const htmlString = (await remark()
      .use(html)
      .process(md))
      .toString();

    return htmlString;
  }

  private async waitPdfExportFinish(pageBulkExportJob: PageBulkExportJobDocument): Promise<void> {
    const jobCreatedAt = pageBulkExportJob.createdAt;
    if (jobCreatedAt == null) throw new Error('createdAt is not set');

    const exportJobExpirationSeconds = configManager.getConfig('crowi', 'app:bulkExportJobExpirationSeconds');
    const jobExpirationDate = new Date(jobCreatedAt.getTime() + exportJobExpirationSeconds * 1000);
    let status: PdfCtrlSyncJobStatusBodyStatus = PdfCtrlSyncJobStatusBodyStatus.HTML_EXPORT_IN_PROGRESS;

    const lastExportPagePath = (await PageBulkExportPageSnapshot.findOne({ pageBulkExportJob }).sort({ path: -1 }))?.path;
    if (lastExportPagePath == null) throw new Error('lastExportPagePath is missing');

    return new Promise<void>((resolve, reject) => {
      const interval = setInterval(async() => {
        if (new Date() > jobExpirationDate) {
          reject(new BulkExportJobExpiredError());
        }
        try {
          const latestPageBulkExportJob = await PageBulkExportJob.findById(pageBulkExportJob._id);
          if (latestPageBulkExportJob == null) throw new Error('pageBulkExportJob is missing');
          if (latestPageBulkExportJob.lastExportedPagePath === lastExportPagePath) {
            status = PdfCtrlSyncJobStatusBodyStatus.HTML_EXPORT_DONE;
          }

          if (latestPageBulkExportJob.status === PageBulkExportJobStatus.failed) {
            status = PdfCtrlSyncJobStatusBodyStatus.FAILED;
          }

          const res = await pdfCtrlSyncJobStatus({
            jobId: pageBulkExportJob._id.toString(), expirationDate: jobExpirationDate.toISOString(), status,
          }, { baseURL: configManager.getConfig('crowi', 'app:pageBulkExportPdfConverterUrl') });

          if (res.data.status === PdfCtrlSyncJobStatus202Status.PDF_EXPORT_DONE) {
            clearInterval(interval);
            resolve();
          }
          else if (res.data.status === PdfCtrlSyncJobStatus202Status.FAILED) {
            clearInterval(interval);
            reject(new Error('PDF export failed'));
          }
        }
        catch (err) {
          // continue the loop if the host is not ready
          if (!['ENOTFOUND', 'ECONNREFUSED'].includes(err.code)) {
            clearInterval(interval);
            reject(err);
          }
        }
      }, 60 * 1000 * 1);
    });
  }

  /**
   * Execute a pipeline that reads the page files from the temporal fs directory, compresses them, and uploads to the cloud storage
   */
  private async compressAndUpload(user, pageBulkExportJob: PageBulkExportJobDocument): Promise<void> {
    const pageArchiver = this.setUpPageArchiver();
    const bufferToPartSizeTransform = getBufferToFixedSizeTransform(this.maxPartSize);

    if (pageBulkExportJob.revisionListHash == null) throw new Error('revisionListHash is not set');
    const originalName = `${pageBulkExportJob.revisionListHash}.${this.compressExtension}`;
    const attachment = Attachment.createWithoutSave(null, user, originalName, this.compressExtension, 0, AttachmentType.PAGE_BULK_EXPORT);
    const uploadKey = `${FilePathOnStoragePrefix.pageBulkExport}/${attachment.fileName}`;

    const fileUploadService: FileUploader = this.crowi.fileUploadService;
    // if the process of uploading was interrupted, delete and start from the start
    if (pageBulkExportJob.uploadKey != null && pageBulkExportJob.uploadId != null) {
      await fileUploadService.abortPreviousMultipartUpload(pageBulkExportJob.uploadKey, pageBulkExportJob.uploadId);
    }

    // init multipart upload
    const multipartUploader: IMultipartUploader = fileUploadService.createMultipartUploader(uploadKey, this.maxPartSize);
    await multipartUploader.initUpload();
    pageBulkExportJob.uploadKey = uploadKey;
    pageBulkExportJob.uploadId = multipartUploader.uploadId;
    await pageBulkExportJob.save();

    const multipartUploadWritable = this.getMultipartUploadWritable(multipartUploader, pageBulkExportJob, attachment);

    const compressAndUploadPromise = pipelinePromise(pageArchiver, bufferToPartSizeTransform, multipartUploadWritable);
    pageArchiver.directory(this.getTmpOutputDir(pageBulkExportJob), false);
    pageArchiver.finalize();

    await compressAndUploadPromise;
  }

  private setUpPageArchiver(): Archiver {
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

  private getMultipartUploadWritable(
      multipartUploader: IMultipartUploader,
      pageBulkExportJob: PageBulkExportJobDocument,
      attachment: IAttachmentDocument,
  ): Writable {
    let partNumber = 1;

    return new Writable({
      write: async(part: Buffer, encoding, callback) => {
        try {
          await multipartUploader.uploadPart(part, partNumber);
          partNumber += 1;
          // First aid to prevent unexplained memory leaks
          logger.info('global.gc() invoked.');
          gc();
        }
        catch (err) {
          await multipartUploader.abortUpload();
          pageBulkExportJob.status = PageBulkExportJobStatus.failed;
          await pageBulkExportJob.save();
          callback(err);
          return;
        }
        callback();
      },
      final: async(callback) => {
        try {
          await multipartUploader.completeUpload();

          const fileSize = await multipartUploader.getUploadedFileSize();
          attachment.fileSize = fileSize;
          await attachment.save();

          pageBulkExportJob.completedAt = new Date();
          pageBulkExportJob.attachment = attachment._id;
          await pageBulkExportJob.save();
        }
        catch (err) {
          callback(err);
          return;
        }
        callback();
      },
    });
  }

  /**
   * Get the output directory on the fs to temporarily store page files before compressing and uploading
   */
  private getTmpOutputDir(pageBulkExportJob: PageBulkExportJobDocument, isHtmlPath = false): string {
    if (isHtmlPath) {
      return path.join(this.tmpOutputRootDir, 'html', pageBulkExportJob._id.toString());
    }
    return path.join(this.tmpOutputRootDir, pageBulkExportJob._id.toString());
  }

  async notifyExportResult(
      pageBulkExportJob: PageBulkExportJobDocument, action: SupportedActionType, activityParameters?: ActivityParameters,
  ) {
    const activity = await this.crowi.activityService.createActivity({
      ...activityParameters,
      action,
      targetModel: SupportedTargetModel.MODEL_PAGE_BULK_EXPORT_JOB,
      target: pageBulkExportJob,
      user: pageBulkExportJob.user,
      snapshot: {
        username: isPopulated(pageBulkExportJob.user) ? pageBulkExportJob.user.username : '',
      },
    });
    const getAdditionalTargetUsers = async(activity: ActivityDocument) => [activity.user];
    const preNotify = preNotifyService.generatePreNotify(activity, getAdditionalTargetUsers);
    this.activityEvent.emit('updated', activity, pageBulkExportJob, preNotify);
  }

  /**
   * Do the following in parallel:
   * - delete page snapshots
   * - remove the temporal output directory
   * - abort multipart upload
   */
  async cleanUpExportJobResources(pageBulkExportJob: PageBulkExportJobDocument, restarted = false) {
    this.pageBulkExportJobManager.removeJobInProgressAndQueueNextJob(pageBulkExportJob._id, restarted);

    const promises = [
      PageBulkExportPageSnapshot.deleteMany({ pageBulkExportJob }),
      fs.promises.rm(this.getTmpOutputDir(pageBulkExportJob), { recursive: true, force: true }),
    ];

    if (pageBulkExportJob.format === PageBulkExportFormat.pdf) {
      promises.push(
        fs.promises.rm(this.getTmpOutputDir(pageBulkExportJob, true), { recursive: true, force: true }),
      );
    }

    const fileUploadService: FileUploader = this.crowi.fileUploadService;
    if (pageBulkExportJob.uploadKey != null && pageBulkExportJob.uploadId != null) {
      promises.push(fileUploadService.abortPreviousMultipartUpload(pageBulkExportJob.uploadKey, pageBulkExportJob.uploadId));
    }

    const results = await Promise.allSettled(promises);
    results.forEach((result) => {
      if (result.status === 'rejected') logger.error(result.reason);
    });
  }

}

// eslint-disable-next-line import/no-mutable-exports
export let pageBulkExportService: PageBulkExportService | undefined; // singleton instance
export default function instanciate(crowi): void {
  pageBulkExportService = new PageBulkExportService(crowi);
}
