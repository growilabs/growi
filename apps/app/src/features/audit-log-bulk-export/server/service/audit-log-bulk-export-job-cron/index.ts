import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { IUser } from '@growi/core';
import { getIdForRef, isPopulated } from '@growi/core';
import type archiver from 'archiver';
import mongoose from 'mongoose';

import type { SupportedActionType } from '~/interfaces/activity';
import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import CronService from '~/server/service/cron';
import loggerFactory from '~/utils/logger';

import {
  AuditLogBulkExportJobInProgressJobStatus,
  AuditLogBulkExportJobStatus,
} from '../../../interfaces/audit-log-bulk-export';
import type { AuditLogBulkExportJobDocument } from '../../models/audit-log-bulk-export-job';
import AuditLogBulkExportJob from '../../models/audit-log-bulk-export-job';
import {
  AuditLogBulkExportJobExpiredError,
  AuditLogBulkExportJobRestartedError,
} from './errors';

const logger = loggerFactory('growi:service:audit-log-export-job-cron');

export interface IAuditLogBulkExportJobCronService {
  crowi: Crowi;
  activityEvent: NodeJS.EventEmitter;
  tmpOutputRootDir: string;
  pageBatchSize: number;
  maxLogsPerFile: number;
  compressFormat: archiver.Format;
  compressLevel: number;
  proceedBulkExportJob(
    auditLogBulkExportJob: AuditLogBulkExportJobDocument,
  ): Promise<void>;
  getTmpOutputDir(auditLogBulkExportJob: AuditLogBulkExportJobDocument): string;
  getStreamInExecution(jobId: ObjectIdLike): Readable | undefined;
  setStreamInExecution(jobId: ObjectIdLike, stream: Readable): void;
  removeStreamInExecution(jobId: ObjectIdLike): void;
  notifyExportResultAndCleanUp(
    action: SupportedActionType,
    auditLogBulkExportJob: AuditLogBulkExportJobDocument,
  ): Promise<void>;
  handleError(
    err: Error | null,
    auditLogBulkExportJob: AuditLogBulkExportJobDocument,
  ): Promise<void>;
  cleanUpExportJobResources(
    auditLogBulkExportJob: AuditLogBulkExportJobDocument,
    restarted?: boolean,
  ): Promise<void>;
}

import type { ActivityDocument } from '~/server/models/activity';
import { preNotifyService } from '~/server/service/pre-notify';

import { compressAndUpload } from './steps/compress-and-upload';
import { exportAuditLogsToFsAsync } from './steps/exportAuditLogsToFsAsync';

/**
 * Manages cronjob which proceeds AuditLogBulkExportJobs in progress.
 * If AuditLogBulkExportJob finishes the current step, the next step will be started on the next cron execution.
 */
class AuditLogBulkExportJobCronService
  extends CronService
  implements IAuditLogBulkExportJobCronService
{
  crowi: Crowi;

  activityEvent: NodeJS.EventEmitter;

  private parallelExecLimit: number;

  tmpOutputRootDir = '/tmp/audit-log-bulk-export';

  pageBatchSize = 100;

  maxLogsPerFile = 50;

  compressFormat: archiver.Format = 'zip';

  compressLevel = 6;

  private streamInExecutionMemo: { [key: string]: Readable } = {};

  constructor(crowi: Crowi) {
    super();
    this.crowi = crowi;
    this.activityEvent = crowi.event('activity');
    this.parallelExecLimit = 1;
  }

  override getCronSchedule(): string {
    return '*/10 * * * * *';
  }

  override async executeJob(): Promise<void> {
    const auditLogBulkExportJobInProgress = await AuditLogBulkExportJob.find({
      $or: Object.values(AuditLogBulkExportJobInProgressJobStatus).map(
        (status) => ({
          status,
        }),
      ),
    })
      .sort({ createdAt: 1 })
      .limit(this.parallelExecLimit);
    await Promise.all(
      auditLogBulkExportJobInProgress.map((auditLogBulkExportJob) =>
        this.proceedBulkExportJob(auditLogBulkExportJob),
      ),
    );
  }

  async proceedBulkExportJob(
    auditLogBulkExportJob: AuditLogBulkExportJobDocument,
  ) {
    try {
      if (auditLogBulkExportJob.restartFlag) {
        await this.cleanUpExportJobResources(auditLogBulkExportJob, true);
        auditLogBulkExportJob.restartFlag = false;
        auditLogBulkExportJob.status = AuditLogBulkExportJobStatus.exporting;
        auditLogBulkExportJob.lastExportedId = undefined;
        auditLogBulkExportJob.totalExportedCount = 0;
        await auditLogBulkExportJob.save();
        return;
      }
      const User = mongoose.model<IUser>('User');
      const user = await User.findById(getIdForRef(auditLogBulkExportJob.user));

      if (!user) {
        throw new Error(
          `User not found for audit log export job: ${auditLogBulkExportJob._id}`,
        );
      }

      if (
        auditLogBulkExportJob.status === AuditLogBulkExportJobStatus.exporting
      ) {
        await exportAuditLogsToFsAsync.bind(this)(auditLogBulkExportJob);
      } else if (
        auditLogBulkExportJob.status === AuditLogBulkExportJobStatus.uploading
      ) {
        await compressAndUpload.bind(this)(user, auditLogBulkExportJob);
      }
    } catch (err) {
      logger.error(err);
    }
  }

  getTmpOutputDir(
    auditLogBulkExportJob: AuditLogBulkExportJobDocument,
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

  async notifyExportResultAndCleanUp(
    action: SupportedActionType,
    auditLogBulkExportJob: AuditLogBulkExportJobDocument,
  ): Promise<void> {
    auditLogBulkExportJob.status =
      action === SupportedAction.ACTION_AUDIT_LOG_BULK_EXPORT_COMPLETED
        ? AuditLogBulkExportJobStatus.completed
        : AuditLogBulkExportJobStatus.failed;

    try {
      await auditLogBulkExportJob.save();
      await this.notifyExportResult(auditLogBulkExportJob, action);
    } catch (err) {
      logger.error(err);
    }
    await this.cleanUpExportJobResources(auditLogBulkExportJob);
  }

  private async notifyExportResult(
    auditLogBulkExportJob: AuditLogBulkExportJobDocument,
    action: SupportedActionType,
  ) {
    logger.debug(
      'Creating activity with targetModel:',
      SupportedTargetModel.MODEL_AUDIT_LOG_BULK_EXPORT_JOB,
    );
    const activity = await this.crowi.activityService.createActivity({
      action,
      targetModel: SupportedTargetModel.MODEL_AUDIT_LOG_BULK_EXPORT_JOB,
      target: auditLogBulkExportJob,
      user: auditLogBulkExportJob.user,
      snapshot: {
        username: isPopulated(auditLogBulkExportJob.user)
          ? auditLogBulkExportJob.user.username
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
    this.activityEvent.emit(
      'updated',
      activity,
      auditLogBulkExportJob,
      preNotify,
    );
  }

  async handleError(
    err: Error | null,
    auditLogBulkExportJob: AuditLogBulkExportJobDocument,
  ) {
    if (err == null) return;

    if (err instanceof AuditLogBulkExportJobExpiredError) {
      logger.error(err);
      await this.notifyExportResultAndCleanUp(
        SupportedAction.ACTION_AUDIT_LOG_BULK_EXPORT_JOB_EXPIRED,
        auditLogBulkExportJob,
      );
    } else if (err instanceof AuditLogBulkExportJobRestartedError) {
      logger.info(err.message);
      await this.cleanUpExportJobResources(auditLogBulkExportJob);
    } else {
      logger.error(err);
      await this.notifyExportResultAndCleanUp(
        SupportedAction.ACTION_AUDIT_LOG_BULK_EXPORT_FAILED,
        auditLogBulkExportJob,
      );
    }
  }

  async cleanUpExportJobResources(
    auditLogBulkExportJob: AuditLogBulkExportJobDocument,
    restarted = false,
  ) {
    const streamInExecution = this.getStreamInExecution(
      auditLogBulkExportJob._id,
    );
    if (streamInExecution != null) {
      if (restarted) {
        streamInExecution.destroy(new AuditLogBulkExportJobRestartedError());
      } else {
        streamInExecution.destroy(new AuditLogBulkExportJobExpiredError());
      }
      this.removeStreamInExecution(auditLogBulkExportJob._id);
    }

    const promises = [
      fs.promises.rm(this.getTmpOutputDir(auditLogBulkExportJob), {
        recursive: true,
        force: true,
      }),
    ];

    const results = await Promise.allSettled(promises);
    results.forEach((result) => {
      if (result.status === 'rejected') logger.error(result.reason);
    });
  }
}

// eslint-disable-next-line import/no-mutable-exports
export let auditLogBulkExportJobCronService:
  | AuditLogBulkExportJobCronService
  | undefined;
export default function instantiate(crowi: Crowi): void {
  auditLogBulkExportJobCronService = new AuditLogBulkExportJobCronService(
    crowi,
  );
}
