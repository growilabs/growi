import fs from 'node:fs';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { IUser } from '@growi/core';
import mongoose from 'mongoose';

import type { pagebulkexportjobs } from '~/generated/prisma/client';
import type { SupportedActionType } from '~/interfaces/activity';
import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import { configManager } from '~/server/service/config-manager';
import CronService from '~/server/service/cron';
import { preNotifyService } from '~/server/service/pre-notify';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import {
  PageBulkExportFormat,
  PageBulkExportJobInProgressStatus,
  PageBulkExportJobStatus,
} from '../../../interfaces/page-bulk-export';
import PageBulkExportPageSnapshot from '../../models/page-bulk-export-page-snapshot';
import {
  BulkExportJobExpiredError,
  BulkExportJobStreamDestroyedByCleanupError,
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
  setStreamsInExecution(
    jobId: ObjectIdLike,
    ...streams: (Readable | Writable)[]
  ): void;
  removeStreamInExecution(jobId: ObjectIdLike): void;
  handleError(err: Error | null, pageBulkExportJob: pagebulkexportjobs): void;
  notifyExportResultAndCleanUp(
    action: SupportedActionType,
    pageBulkExportJob: pagebulkexportjobs,
  ): Promise<void>;
  getTmpOutputDir(
    pageBulkExportJob: pagebulkexportjobs,
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

  // Keep track of all streams executed for PageBulkExportJob to destroy them on job failure.
  // The key is the id of a PageBulkExportJob, value is array of streams.
  private streamInExecutionMemo: {
    [key: string]: (Readable | Writable)[];
  } = {};

  private parallelExecLimit: number;

  constructor(crowi: Crowi) {
    super();
    this.crowi = crowi;
    this.activityEvent = crowi.events.activity;
    this.parallelExecLimit = configManager.getConfig(
      'app:pageBulkExportParallelExecLimit',
    );
  }

  override getCronSchedule(): string {
    return configManager.getConfig('app:pageBulkExportJobCronSchedule');
  }

  override async executeJob(): Promise<void> {
    const pageBulkExportJobsInProgress =
      await prisma.pagebulkexportjobs.findMany({
        where: {
          status: { in: Object.values(PageBulkExportJobInProgressStatus) },
        },
        orderBy: { createdAt: 'asc' },
        take: this.parallelExecLimit,
      });

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
    pageBulkExportJob: pagebulkexportjobs,
    isHtmlPath = false,
  ): string {
    const jobId = pageBulkExportJob.id;
    return isHtmlPath
      ? path.join(this.tmpOutputRootDir, 'html', jobId)
      : path.join(this.tmpOutputRootDir, jobId);
  }

  /**
   * Get all streams in execution for a job.
   * A getter method that includes "undefined" in the return type
   */
  getStreamsInExecution(
    jobId: ObjectIdLike,
  ): (Readable | Writable)[] | undefined {
    return this.streamInExecutionMemo[jobId.toString()];
  }

  /**
   * Set streams in execution for a job
   */
  setStreamsInExecution(
    jobId: ObjectIdLike,
    ...streams: (Readable | Writable)[]
  ) {
    this.streamInExecutionMemo[jobId.toString()] = streams;
  }

  /**
   * Remove all streams in execution for a job
   */
  removeStreamInExecution(jobId: ObjectIdLike) {
    delete this.streamInExecutionMemo[jobId.toString()];
  }

  /**
   * Proceed the page bulk export job if the next step is executable
   * @param pageBulkExportJob PageBulkExportJob in progress
   */
  async proceedBulkExportJob(pageBulkExportJob: pagebulkexportjobs) {
    let job = pageBulkExportJob;
    try {
      if (job.restartFlag) {
        await this.cleanUpExportJobResources(job);
        job = await prisma.pagebulkexportjobs.update({
          where: { id: job.id },
          data: {
            restartFlag: false,
            status: PageBulkExportJobStatus.initializing,
            statusOnPreviousCronExec: null,
          },
        });
      }

      if (
        job.status === PageBulkExportJobStatus.exporting &&
        job.format === PageBulkExportFormat.pdf
      ) {
        job = await requestPdfConverter(job);
      }

      // return if job is still the same status as the previous cron exec
      if (job.status === job.statusOnPreviousCronExec) {
        return;
      }

      const User = mongoose.model<IUser>('User');
      const user = await User.findById(job.userId);

      // update statusOnPreviousCronExec before starting processes that updates status
      job = await prisma.pagebulkexportjobs.update({
        where: { id: job.id },
        data: { statusOnPreviousCronExec: job.status },
      });

      if (job.status === PageBulkExportJobStatus.initializing) {
        await createPageSnapshotsAsync.bind(this)(user, job);
      } else if (job.status === PageBulkExportJobStatus.exporting) {
        await exportPagesToFsAsync.bind(this)(job);
      } else if (job.status === PageBulkExportJobStatus.uploading) {
        compressAndUpload.bind(this)(user, job);
      }
    } catch (err) {
      logger.error(err);
      await this.notifyExportResultAndCleanUp(
        SupportedAction.ACTION_PAGE_BULK_EXPORT_FAILED,
        job,
      );
    }
  }

  /**
   * Handle errors that occurred during page bulk export
   * @param err error
   * @param pageBulkExportJob PageBulkExportJob executed in the pipeline
   */
  async handleError(err: Error | null, pageBulkExportJob: pagebulkexportjobs) {
    if (err == null) return;

    if (err instanceof BulkExportJobExpiredError) {
      logger.error(err);
      await this.notifyExportResultAndCleanUp(
        SupportedAction.ACTION_PAGE_BULK_EXPORT_JOB_EXPIRED,
        pageBulkExportJob,
      );
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
    pageBulkExportJob: pagebulkexportjobs,
  ): Promise<void> {
    const isCompleted =
      action === SupportedAction.ACTION_PAGE_BULK_EXPORT_COMPLETED;

    let job = pageBulkExportJob;
    try {
      job = await prisma.pagebulkexportjobs.update({
        where: { id: pageBulkExportJob.id },
        data: {
          status: isCompleted
            ? PageBulkExportJobStatus.completed
            : PageBulkExportJobStatus.failed,
          // Guarantee completedAt is set for every completion path (including the
          // duplicate-reuse path in createPageSnapshotsAsync, which marks the job as
          // completed without setting completedAt). Without this, the download-expiration
          // cleanup query `{ completedAt: { lt } }` never matches such jobs (MongoDB
          // type bracketing excludes null), so they accumulate forever.
          ...(isCompleted && pageBulkExportJob.completedAt == null
            ? { completedAt: new Date() }
            : {}),
        },
      });
      await this.notifyExportResult(job, action);
    } catch (err) {
      logger.error(err);
    }
    // execute independently of notif process resolve/reject
    await this.cleanUpExportJobResources(job);
  }

  /**
   * Do the following in parallel:
   * - delete page snapshots
   * - remove the temporal output directory
   */
  async cleanUpExportJobResources(pageBulkExportJob: pagebulkexportjobs) {
    const streamsInExecution = this.getStreamsInExecution(pageBulkExportJob.id);
    if (streamsInExecution != null && streamsInExecution.length > 0) {
      // Wait for all streams to be destroyed before proceeding with cleanup
      await Promise.allSettled(
        streamsInExecution.map((stream) => {
          if (!stream.destroyed) {
            return new Promise<void>((resolve) => {
              stream.destroy(new BulkExportJobStreamDestroyedByCleanupError());
              stream.once('close', () => resolve());
            });
          }
          return Promise.resolve();
        }),
      );

      this.removeStreamInExecution(pageBulkExportJob.id);
    }

    const promises = [
      PageBulkExportPageSnapshot.deleteMany({
        pageBulkExportJob: pageBulkExportJob.id,
      }),
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
    pageBulkExportJob: pagebulkexportjobs,
    action: SupportedActionType,
  ) {
    const activity = await this.crowi.activityService.createActivity({
      action,
      targetModel: SupportedTargetModel.MODEL_PAGE_BULK_EXPORT_JOB,
      target: pageBulkExportJob,
      user: pageBulkExportJob.userId,
      snapshot: {
        username: '',
      },
    });
    if (activity == null) {
      return;
    }
    // createActivity's result never has `user` populated (only `userId`) --
    // reference the acting user we already have on hand instead.
    const getAdditionalTargetUsers = async () => [pageBulkExportJob.userId];
    const preNotify = preNotifyService.generatePreNotify(
      activity,
      getAdditionalTargetUsers,
    );
    this.activityEvent.emit('updated', activity, pageBulkExportJob, preNotify);
  }
}

export let pageBulkExportJobCronService:
  | PageBulkExportJobCronService
  | undefined; // singleton instance
export default function instanciate(crowi: Crowi): void {
  pageBulkExportJobCronService = new PageBulkExportJobCronService(crowi);
}
