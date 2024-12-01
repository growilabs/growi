import fs from 'fs';
import type { Readable } from 'stream';

import type { IPage, IUser } from '@growi/core';
import { isPopulated, getIdForRef } from '@growi/core';
import mongoose from 'mongoose';


import type { SupportedActionType } from '~/interfaces/activity';
import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import type { ActivityDocument } from '~/server/models/activity';
import type { PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import CronService from '~/server/service/cron';
import type { FileUploader } from '~/server/service/file-uploader';
import { preNotifyService } from '~/server/service/pre-notify';
import loggerFactory from '~/utils/logger';

import { PageBulkExportJobInProgressStatus, PageBulkExportJobStatus } from '../../../interfaces/page-bulk-export';
import type { PageBulkExportJobDocument } from '../../models/page-bulk-export-job';
import PageBulkExportJob from '../../models/page-bulk-export-job';
import PageBulkExportPageSnapshot from '../../models/page-bulk-export-page-snapshot';


import { BulkExportJobExpiredError, BulkExportJobRestartedError } from './errors';
import { compressAndUploadAsync } from './steps/compress-and-upload-async';
import { createPageSnapshotsAsync } from './steps/create-page-snapshots-async';
import { exportPagesToFsAsync } from './steps/export-pages-to-fs-async';


const logger = loggerFactory('growi:service:page-bulk-export-job-cron');

export interface IPageBulkExportJobCronService {
  crowi: any;
  pageModel: PageModel;
  pageBatchSize: number;
  maxPartSize: number;
  compressExtension: string;
  setStreamInExecution(jobId: ObjectIdLike, stream: Readable): void;
  handlePipelineError(err: Error | null, pageBulkExportJob: PageBulkExportJobDocument): void;
  notifyExportResultAndCleanUp(action: SupportedActionType, pageBulkExportJob: PageBulkExportJobDocument): Promise<void>;
  getTmpOutputDir(pageBulkExportJob: PageBulkExportJobDocument): string;
}

/**
 * Manages cronjob which proceeds PageBulkExportJobs in progress.
 * If PageBulkExportJob finishes the current step, the next step will be started on the next cron execution.
 */
class PageBulkExportJobCronService extends CronService implements IPageBulkExportJobCronService {

  crowi: any;

  activityEvent: any;

  // multipart upload max part size
  maxPartSize = 5 * 1024 * 1024; // 5MB

  pageBatchSize = 100;

  compressExtension = 'tar.gz';

  // temporal path of local fs to output page files before upload
  // TODO: If necessary, change to a proper path in https://redmine.weseek.co.jp/issues/149512
  tmpOutputRootDir = '/tmp/page-bulk-export';

  pageModel: PageModel;

  userModel: mongoose.Model<IUser>;

  // Keep track of the stream executed for PageBulkExportJob to destroy it on job failure.
  // The key is the id of a PageBulkExportJob.
  private streamInExecutionMemo: {
    [key: string]: Readable;
  } = {};

  private parallelExecLimit: number;

  constructor(crowi) {
    super();
    this.crowi = crowi;
    this.activityEvent = crowi.event('activity');
    this.pageModel = mongoose.model<IPage, PageModel>('Page');
    this.userModel = mongoose.model<IUser>('User');
    this.parallelExecLimit = configManager.getConfig('crowi', 'app:pageBulkExportParallelExecLimit');
  }

  override getCronSchedule(): string {
    return configManager.getConfig('crowi', 'app:pageBulkExportJobCronSchedule');
  }

  override async executeJob(): Promise<void> {
    const pageBulkExportJobsInProgress = await PageBulkExportJob.find({
      $or: Object.values(PageBulkExportJobInProgressStatus).map(status => ({ status })),
    }).sort({ createdAt: 1 }).limit(this.parallelExecLimit);

    pageBulkExportJobsInProgress.forEach((pageBulkExportJob) => {
      this.proceedBulkExportJob(pageBulkExportJob);
    });
  }

  /**
   * Get the output directory on the fs to temporarily store page files before compressing and uploading
   */
  getTmpOutputDir(pageBulkExportJob: PageBulkExportJobDocument): string {
    return `${this.tmpOutputRootDir}/${pageBulkExportJob._id}`;
  }

  /**
   * Get the stream in execution for a job.
   * A getter method that includes "undefined" in the return type
   */
  getStreamInExecution(jobId: ObjectIdLike): Readable | undefined {
    return this.streamInExecutionMemo[jobId.toString()];
  }

  /**
   * Set the stream in execution for a job
   */
  setStreamInExecution(jobId: ObjectIdLike, stream: Readable) {
    this.streamInExecutionMemo[jobId.toString()] = stream;
  }

  /**
   * Remove the stream in execution for a job
   */
  removeStreamInExecution(jobId: ObjectIdLike) {
    delete this.streamInExecutionMemo[jobId.toString()];
  }

  /**
   * Proceed the page bulk export job if the next step is executable
   * @param pageBulkExportJob PageBulkExportJob in progress
   */
  async proceedBulkExportJob(pageBulkExportJob: PageBulkExportJobDocument) {
    if (pageBulkExportJob.restartFlag) {
      await this.cleanUpExportJobResources(pageBulkExportJob, true);
      pageBulkExportJob.restartFlag = false;
      pageBulkExportJob.status = PageBulkExportJobStatus.initializing;
      pageBulkExportJob.statusOnPreviousCronExec = undefined;
      await pageBulkExportJob.save();
    }

    // return if job is still the same status as the previous cron exec
    if (pageBulkExportJob.status === pageBulkExportJob.statusOnPreviousCronExec) {
      return;
    }
    try {
      const user = await this.userModel.findById(getIdForRef(pageBulkExportJob.user));

      // update statusOnPreviousCronExec before starting processes that updates status
      pageBulkExportJob.statusOnPreviousCronExec = pageBulkExportJob.status;
      await pageBulkExportJob.save();

      if (pageBulkExportJob.status === PageBulkExportJobStatus.initializing) {
        await createPageSnapshotsAsync.bind(this)(user, pageBulkExportJob);
      }
      else if (pageBulkExportJob.status === PageBulkExportJobStatus.exporting) {
        exportPagesToFsAsync.bind(this)(pageBulkExportJob);
      }
      else if (pageBulkExportJob.status === PageBulkExportJobStatus.uploading) {
        await compressAndUploadAsync.bind(this)(user, pageBulkExportJob);
      }
    }
    catch (err) {
      logger.error(err);
      await this.notifyExportResultAndCleanUp(SupportedAction.ACTION_PAGE_BULK_EXPORT_FAILED, pageBulkExportJob);
    }
  }

  /**
   * Handle errors that occurred inside a stream pipeline
   * @param err error
   * @param pageBulkExportJob PageBulkExportJob executed in the pipeline
   */
  async handlePipelineError(err: Error | null, pageBulkExportJob: PageBulkExportJobDocument) {
    if (err == null) return;

    if (err instanceof BulkExportJobExpiredError) {
      logger.error(err);
      await this.notifyExportResultAndCleanUp(SupportedAction.ACTION_PAGE_BULK_EXPORT_JOB_EXPIRED, pageBulkExportJob);
    }
    else if (err instanceof BulkExportJobRestartedError) {
      logger.info(err.message);
      await this.cleanUpExportJobResources(pageBulkExportJob);
    }
    else {
      logger.error(err);
      await this.notifyExportResultAndCleanUp(SupportedAction.ACTION_PAGE_BULK_EXPORT_FAILED, pageBulkExportJob);
    }
  }

  /**
   * Notify the user of the export result, and cleanup the resources used in the export process
   * @param action whether the export was successful
   * @param pageBulkExportJob the page bulk export job
   */
  async notifyExportResultAndCleanUp(
      action: SupportedActionType,
      pageBulkExportJob: PageBulkExportJobDocument,
  ): Promise<void> {
    pageBulkExportJob.status = action === SupportedAction.ACTION_PAGE_BULK_EXPORT_COMPLETED
      ? PageBulkExportJobStatus.completed : PageBulkExportJobStatus.failed;

    try {
      await pageBulkExportJob.save();
      await this.notifyExportResult(pageBulkExportJob, action);
    }
    catch (err) {
      logger.error(err);
    }
    // execute independently of notif process resolve/reject
    await this.cleanUpExportJobResources(pageBulkExportJob);
  }

  /**
   * Do the following in parallel:
   * - delete page snapshots
   * - remove the temporal output directory
   * - abort multipart upload
   */
  async cleanUpExportJobResources(pageBulkExportJob: PageBulkExportJobDocument, restarted = false) {
    const streamInExecution = this.getStreamInExecution(pageBulkExportJob._id);
    if (streamInExecution != null) {
      if (restarted) {
        streamInExecution.destroy(new BulkExportJobRestartedError());
      }
      else {
        streamInExecution.destroy(new BulkExportJobExpiredError());
      }
    }
    this.removeStreamInExecution(pageBulkExportJob._id);

    const promises = [
      PageBulkExportPageSnapshot.deleteMany({ pageBulkExportJob }),
      fs.promises.rm(this.getTmpOutputDir(pageBulkExportJob), { recursive: true, force: true }),
    ];

    const fileUploadService: FileUploader = this.crowi.fileUploadService;
    if (pageBulkExportJob.uploadKey != null && pageBulkExportJob.uploadId != null) {
      promises.push(fileUploadService.abortPreviousMultipartUpload(pageBulkExportJob.uploadKey, pageBulkExportJob.uploadId));
    }

    const results = await Promise.allSettled(promises);
    results.forEach((result) => {
      if (result.status === 'rejected') logger.error(result.reason);
    });
  }

  private async notifyExportResult(
      pageBulkExportJob: PageBulkExportJobDocument, action: SupportedActionType,
  ) {
    const activity = await this.crowi.activityService.createActivity({
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

}

// eslint-disable-next-line import/no-mutable-exports
export let pageBulkExportJobCronService: PageBulkExportJobCronService | undefined; // singleton instance
export default function instanciate(crowi): void {
  pageBulkExportJobCronService = new PageBulkExportJobCronService(crowi);
}
