import fs from 'fs';
import path from 'path';
import type { Readable } from 'stream';

import type { IUser } from '@growi/core';
import { getIdForRef, isPopulated } from '@growi/core';
import mongoose from 'mongoose';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type { SupportedActionType } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import type { ActivityDocument } from '~/server/models/activity';
import { configManager } from '~/server/service/config-manager';
import CronService from '~/server/service/cron';
import { preNotifyService } from '~/server/service/pre-notify';
import loggerFactory from '~/utils/logger';

import { AuditLogExportJobStatus, AuditLogExportJobInProgressStatus } from '../../../interfaces/audit-log-bulk-export';
import AuditLogExportJob from '../../models/audit-log-bulk-export-job';
import type { AuditLogExportJobDocument } from '../../models/audit-log-bulk-export-job';


import {
  AuditLogExportJobExpiredError,
  AuditLogExportJobRestartedError,
} from './errors';
import { compressAndUpload } from './steps/compress-and-upload';
import { exportAuditLogsToFsAsync } from './steps/exportAuditLogsToFsAsync';

// あとで作る予定のものを import だけ定義しておく
// import { createAuditLogSnapshotsAsync } from './steps/create-audit-log-snapshots-async';
// import { exportAuditLogsToFsAsync } from './steps/export-audit-logs-to-fs-async';
// import { compressAndUpload } from './steps/compress-and-upload';

const logger = loggerFactory('growi:service:audit-log-export-job-cron');

export interface IAuditLogExportJobCronService {
  crowi: Crowi;
  pageBatchSize: number;
  maxPartSize: number;
  compressExtension: string;
  setStreamInExecution(jobId: ObjectIdLike, stream: Readable): void;
  removeStreamInExecution(jobId: ObjectIdLike): void;
  handleError(err: Error | null, auditLogExportJob: AuditLogExportJobDocument): void;
  notifyExportResultAndCleanUp(action: SupportedActionType, auditLogExportJob: AuditLogExportJobDocument): Promise<void>;
  getTmpOutputDir(auditLogExportJob: AuditLogExportJobDocument): string;
}

/**
 * Manages cronjob which proceeds AuditLogExportJobs in progress.
 * If AuditLogExportJob finishes the current step, the next step will be started on the next cron execution.
 */
class AuditLogExportJobCronService
  extends CronService
  implements IAuditLogExportJobCronService {

  crowi: Crowi;

  activityEvent: NodeJS.EventEmitter;

  // multipart upload max part size
  maxPartSize = 5 * 1024 * 1024; // 5MB

  pageBatchSize = 100;

  compressExtension = 'zip';

  tmpOutputRootDir = '/tmp/audit-log-bulk-export';


  private streamInExecutionMemo: { [key: string]: Readable } = {};

  private parallelExecLimit: number;

  constructor(crowi: Crowi) {
    super();
    this.crowi = crowi;
    this.activityEvent = crowi.event('activity');
    this.parallelExecLimit = 1;
  }

  override getCronSchedule(): string {
    return configManager.getConfig('app:auditLogBulkExportJobCronSchedule') || '*/10 * * * * *';
  }

  override async executeJob(): Promise<void> {
    logger.debug('executeJob() called - not implemented yet');
    const auditLogBulkExportJobInProgress = await AuditLogExportJob.find({
      $or: Object.values(AuditLogExportJobInProgressStatus).map(status => ({
        status,
      })),
    })
      .sort({ createdAt: 1 })
      .limit(this.parallelExecLimit);
    auditLogBulkExportJobInProgress.forEach((auditLogBulkExportJob) => {
      this.proceedBulkExportJob(auditLogBulkExportJob);
    });
  }

  getTmpOutputDir(
      auditLogBulkExportJob: AuditLogExportJobDocument,
  ): string {
    const jobId = auditLogBulkExportJob._id.toString();
    return path.join(this.tmpOutputRootDir, jobId);
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

  async proceedBulkExportJob(auditLogExportJob: AuditLogExportJobDocument) {
    try {
      if (auditLogExportJob.restartFlag) {
        await this.cleanUpExportJobResources(auditLogExportJob);
        auditLogExportJob.restartFlag = false;
        auditLogExportJob.status = AuditLogExportJobStatus.exporting;
        auditLogExportJob.statusOnPreviousCronExec = undefined;
        auditLogExportJob.lastExportedAt = undefined;
        auditLogExportJob.lastExportedId = undefined;
        auditLogExportJob.totalExportedCount = 0;
        await auditLogExportJob.save();
      }

      const User = mongoose.model<IUser>('User');
      const user = await User.findById(getIdForRef(auditLogExportJob.user));

      if (!user) {
        throw new Error(`User not found for audit log export job: ${auditLogExportJob._id}`);
      }

      if (
        auditLogExportJob.status === AuditLogExportJobStatus.exporting
      ) {
        loggerFactory('exporting');
        exportAuditLogsToFsAsync.bind(this)(auditLogExportJob);
      }
      else if (
        auditLogExportJob.status === AuditLogExportJobStatus.uploading
      ) {
        await compressAndUpload.bind(this)(user, auditLogExportJob);
      }
    }
    catch (err) {
      logger.error(err);
    }
  }

  async handleError(
      err: Error | null,
      auditLogExportJob: AuditLogExportJobDocument,
  ) {
    if (err == null) return;

    if (err instanceof AuditLogExportJobExpiredError) {
      logger.error(err);
      await this.notifyExportResultAndCleanUp(
        SupportedAction.ACTION_AUDIT_LOG_EXPORT_JOB_EXPIRED,
        auditLogExportJob,
      );
    }
    else if (err instanceof AuditLogExportJobRestartedError) {
      logger.info(err.message);
      await this.cleanUpExportJobResources(auditLogExportJob);
    }
    else {
      logger.error(err);
      await this.notifyExportResultAndCleanUp(
        SupportedAction.ACTION_AUDIT_LOG_EXPORT_FAILED,
        auditLogExportJob,
      );
    }
  }

  async notifyExportResultAndCleanUp(
      action: SupportedActionType,
      auditLogExportJob: AuditLogExportJobDocument,
  ): Promise<void> {
    auditLogExportJob.status = action === SupportedAction.ACTION_AUDIT_LOG_EXPORT_COMPLETED
      ? AuditLogExportJobStatus.completed
      : AuditLogExportJobStatus.failed;

    try {
      await auditLogExportJob.save();
      await this.notifyExportResult(auditLogExportJob, action);
    }
    catch (err) {
      logger.error(err);
    }
    // execute independently of notif process resolve/reject
    await this.cleanUpExportJobResources(auditLogExportJob);
  }

  /**
   * Do the following in parallel:
   * - remove the temporal output directory
   * - destroy any stream in execution
   */
  async cleanUpExportJobResources(
      auditLogExportJob: AuditLogExportJobDocument,
      restarted = false,
  ) {
    const streamInExecution = this.getStreamInExecution(auditLogExportJob._id);
    if (streamInExecution != null) {
      if (restarted) {
        streamInExecution.destroy(new AuditLogExportJobRestartedError());
      }
      else {
        streamInExecution.destroy(new AuditLogExportJobExpiredError());
      }
      this.removeStreamInExecution(auditLogExportJob._id);
    }

    const promises = [
      fs.promises.rm(this.getTmpOutputDir(auditLogExportJob), {
        recursive: true,
        force: true,
      }),
    ];

    const results = await Promise.allSettled(promises);
    results.forEach((result) => {
      if (result.status === 'rejected') logger.error(result.reason);
    });
  }

  private async notifyExportResult(
      auditLogExportJob: AuditLogExportJobDocument,
      action: SupportedActionType,
  ) {
    logger.debug('Creating activity with targetModel:', SupportedTargetModel.MODEL_AUDIT_LOG_EXPORT_JOB);
    const activity = await this.crowi.activityService.createActivity({
      action,
      targetModel: SupportedTargetModel.MODEL_AUDIT_LOG_EXPORT_JOB,
      target: auditLogExportJob,
      user: auditLogExportJob.user,
      snapshot: {
        username: isPopulated(auditLogExportJob.user)
          ? auditLogExportJob.user.username
          : '',
      },
    });
    const getAdditionalTargetUsers = async(activity: ActivityDocument) => [
      activity.user,
    ];
    const preNotify = preNotifyService.generatePreNotify(
      activity,
      getAdditionalTargetUsers,
    );
    this.activityEvent.emit('updated', activity, auditLogExportJob, preNotify);
  }

}

// eslint-disable-next-line import/no-mutable-exports
export let auditLogExportJobCronService:
  | AuditLogExportJobCronService
  | undefined;

export default function instanciate(crowi: Crowi): void {
  try {
    auditLogExportJobCronService = new AuditLogExportJobCronService(crowi);
    auditLogExportJobCronService.startCron();
  }
  catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to start AuditLogExportJobCronService:', error);
  }
}
