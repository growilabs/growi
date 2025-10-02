import type { IUser } from '@growi/core';
import { getIdForRef, isPopulated } from '@growi/core';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import type { Readable } from 'stream';

import type { SupportedActionType } from '~/interfaces/activity';
import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import type { ActivityDocument } from '~/server/models/activity';
import { configManager } from '~/server/service/config-manager';
import CronService from '~/server/service/cron';
import { preNotifyService } from '~/server/service/pre-notify';
import loggerFactory from '~/utils/logger';

import {
  PageBulkExportFormat,
  PageBulkExportJobInProgressStatus,
  PageBulkExportJobStatus,
} from '../../../interfaces/page-bulk-export';
import type { PageBulkExportJobDocument } from '../../models/page-bulk-export-job';
import PageBulkExportJob from '../../models/page-bulk-export-job';
import PageBulkExportPageSnapshot from '../../models/page-bulk-export-page-snapshot';

import {
  BulkExportJobExpiredError,
  BulkExportJobRestartedError,
} from './errors';
import { requestPdfConverter } from './request-pdf-converter';
import { compressAndUpload } from './steps/compress-and-upload';
import { createPageSnapshotsAsync } from './steps/create-page-snapshots-async';
import { exportPagesToFsAsync } from './steps/export-pages-to-fs-async';

const logger = loggerFactory('growi:service:page-bulk-export-job-cron');

export interface IPageBulkExportJobCronService {
  crowi: Crowi;
  pageBatchSize: number;
  maxPartSize: number;
  compressExtension: string;
  setStreamInExecution(jobId: ObjectIdLike, stream: Readable): void;
  removeStreamInExecution(jobId: ObjectIdLike): void;
  handleError(
    err: Error | null,
    pageBulkExportJob: PageBulkExportJobDocument,
  ): void;
  notifyExportResultAndCleanUp(
    action: SupportedActionType,
    pageBulkExportJob: PageBulkExportJobDocument,
  ): Promise<void>;
  getTmpOutputDir(
    pageBulkExportJob: PageBulkExportJobDocument,
    isHtmlPath?: boolean,
  ): string;
}

/**
 * Manages cronjob which proceeds PageBulkExportJobs in progress.
 * If PageBulkExportJob finishes the current step, the next step will be started on the next cron execution.
 */
class PageBulkExportJobCronService
  extends CronService
  implements IPageBulkExportJobCronService
{
  crowi: Crowi;

  activityEvent: any;

  // multipart upload max part size
  maxPartSize = 5 * 1024 * 1024; // 5MB

  pageBatchSize = 100;

  compressExtension = 'tar.gz';

  // temporal path of local fs to output page files before upload
  tmpOutputRootDir = '/tmp/page-bulk-export';

  // Keep track of the stream executed for PageBulkExportJob to destroy it on job failure.
  // The key is the id of a PageBulkExportJob.
  private streamInExecutionMemo: {
    [key: string]: Readable;
  } = {};

  private parallelExecLimit: number;

  constructor(crowi: Crowi) {
    super();
    this.crowi = crowi;
    this.activityEvent = crowi.event('activity');
    this.parallelExecLimit = configManager.getConfig(
      'app:pageBulkExportParallelExecLimit',
    );
  }

  override getCronSchedule(): string {
    return configManager.getConfig('app:pageBulkExportJobCronSchedule');
  }

  override async executeJob(): Promise<void> {
    const pageBulkExportJobsInProgress = await PageBulkExportJob.find({
      $or: Object.values(PageBulkExportJobInProgressStatus).map((status) => ({
        status,
      })),
    })
      .sort({ createdAt: 1 })
      .limit(this.parallelExecLimit);

    pageBulkExportJobsInProgress.forEach((pageBulkExportJob) => {
      this.proceedBulkExportJob(pageBulkExportJob);
    });

    if (pageBulkExportJobsInProgress.length === 0) {
      this.stopCron();
    }
  }

  /**
   * Get the output directory on the fs to temporarily store page files before compressing and uploading
   * @param pageBulkExportJob page bulk export job in execution
   * @param isHtmlPath whether the tmp output path is for html files
   */
  getTmpOutputDir(
    pageBulkExportJob: PageBulkExportJobDocument,
    isHtmlPath = false,
  ): string {
    const jobId = pageBulkExportJob._id.toString();
    return isHtmlPath
      ? path.join(this.tmpOutputRootDir, 'html', jobId)
      : path.join(this.tmpOutputRootDir, jobId);
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
    try {
      if (pageBulkExportJob.restartFlag) {
        await this.cleanUpExportJobResources(pageBulkExportJob, true);
        pageBulkExportJob.restartFlag = false;
        pageBulkExportJob.status = PageBulkExportJobStatus.initializing;
        pageBulkExportJob.statusOnPreviousCronExec = undefined;
        await pageBulkExportJob.save();
      }

      if (
        pageBulkExportJob.status === PageBulkExportJobStatus.exporting &&
        pageBulkExportJob.format === PageBulkExportFormat.pdf
      ) {
        await requestPdfConverter(pageBulkExportJob);
      }

      // return if job is still the same status as the previous cron exec
      if (
        pageBulkExportJob.status === pageBulkExportJob.statusOnPreviousCronExec
      ) {
        return;
      }

      const User = mongoose.model<IUser>('User');
      const user = await User.findById(getIdForRef(pageBulkExportJob.user));

      // update statusOnPreviousCronExec before starting processes that updates status
      pageBulkExportJob.statusOnPreviousCronExec = pageBulkExportJob.status;
      await pageBulkExportJob.save();

      if (pageBulkExportJob.status === PageBulkExportJobStatus.initializing) {
        await createPageSnapshotsAsync.bind(this)(user, pageBulkExportJob);
      } else if (
        pageBulkExportJob.status === PageBulkExportJobStatus.exporting
      ) {
        await exportPagesToFsAsync.bind(this)(pageBulkExportJob);
      } else if (
        pageBulkExportJob.status === PageBulkExportJobStatus.uploading
      ) {
        compressAndUpload.bind(this)(user, pageBulkExportJob);
      }
    } catch (err) {
      logger.error(err);
      await this.notifyExportResultAndCleanUp(
        SupportedAction.ACTION_PAGE_BULK_EXPORT_FAILED,
        pageBulkExportJob,
      );
    }
  }

  /**
   * Handle errors that occurred during page bulk export
   * @param err error
   * @param pageBulkExportJob PageBulkExportJob executed in the pipeline
   */
  async handleError(
    err: Error | null,
    pageBulkExportJob: PageBulkExportJobDocument,
  ) {
    if (err == null) return;

    if (err instanceof BulkExportJobExpiredError) {
      logger.error(err);
      await this.notifyExportResultAndCleanUp(
        SupportedAction.ACTION_PAGE_BULK_EXPORT_JOB_EXPIRED,
        pageBulkExportJob,
      );
    } else if (err instanceof BulkExportJobRestartedError) {
      logger.info(err.message);
      await this.cleanUpExportJobResources(pageBulkExportJob);
    } else {
      logger.error(err);
      await this.notifyExportResultAndCleanUp(
        SupportedAction.ACTION_PAGE_BULK_EXPORT_FAILED,
        pageBulkExportJob,
      );
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
    pageBulkExportJob.status =
      action === SupportedAction.ACTION_PAGE_BULK_EXPORT_COMPLETED
        ? PageBulkExportJobStatus.completed
        : PageBulkExportJobStatus.failed;

    try {
      await pageBulkExportJob.save();
      await this.notifyExportResult(pageBulkExportJob, action);
    } catch (err) {
      logger.error(err);
    }
    // execute independently of notif process resolve/reject
    await this.cleanUpExportJobResources(pageBulkExportJob);
  }

  /**
   * Do the following in parallel:
   * - delete page snapshots
   * - remove the temporal output directory
   */
  async cleanUpExportJobResources(
    pageBulkExportJob: PageBulkExportJobDocument,
    restarted = false,
  ) {
    const streamInExecution = this.getStreamInExecution(pageBulkExportJob._id);
    if (streamInExecution != null) {
      if (restarted) {
        streamInExecution.destroy(new BulkExportJobRestartedError());
      } else {
        streamInExecution.destroy(new BulkExportJobExpiredError());
      }
      this.removeStreamInExecution(pageBulkExportJob._id);
    }

    const promises = [
      PageBulkExportPageSnapshot.deleteMany({ pageBulkExportJob }),
      fs.promises.rm(this.getTmpOutputDir(pageBulkExportJob), {
        recursive: true,
        force: true,
      }),
    ];

    // clean up html files exported for PDF conversion
    if (pageBulkExportJob.format === PageBulkExportFormat.pdf) {
      promises.push(
        fs.promises.rm(this.getTmpOutputDir(pageBulkExportJob, true), {
          recursive: true,
          force: true,
        }),
      );
    }

    const results = await Promise.allSettled(promises);
    results.forEach((result) => {
      if (result.status === 'rejected') logger.error(result.reason);
    });
  }

  private async notifyExportResult(
    pageBulkExportJob: PageBulkExportJobDocument,
    action: SupportedActionType,
  ) {
    const activity = await this.crowi.activityService.createActivity({
      action,
      targetModel: SupportedTargetModel.MODEL_PAGE_BULK_EXPORT_JOB,
      target: pageBulkExportJob,
      user: pageBulkExportJob.user,
      snapshot: {
        username: isPopulated(pageBulkExportJob.user)
          ? pageBulkExportJob.user.username
          : '',
      },
    });
    const getAdditionalTargetUsers = async (activity: ActivityDocument) => [
      activity.user,
    ];
    const preNotify = preNotifyService.generatePreNotify(
      activity,
      getAdditionalTargetUsers,
    );
    this.activityEvent.emit('updated', activity, pageBulkExportJob, preNotify);
  }
}

// eslint-disable-next-line import/no-mutable-exports
export let pageBulkExportJobCronService:
  | PageBulkExportJobCronService
  | undefined; // singleton instance
export default function instanciate(crowi: Crowi): void {
  pageBulkExportJobCronService = new PageBulkExportJobCronService(crowi);
}
