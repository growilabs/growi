import type { IUser } from '@growi/core';
import { getIdForRef, isPopulated } from '@growi/core';
import mongoose from 'mongoose';

import type { SupportedActionType } from '~/interfaces/activity';
import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import CronService from '~/server/service/cron';
import loggerFactory from '~/utils/logger';

import {
  AuditLogBulkExportJobInProgressJobStatus,
  AuditLogBulkExportJobStatus,
} from '../../../interfaces/audit-log-bulk-export';
import type { AuditLogBulkExportJobDocument } from '../../models/audit-log-bulk-export-job';
import AuditLogBulkExportJob from '../../models/audit-log-bulk-export-job';

const logger = loggerFactory('growi:service:audit-log-export-job-cron');

export interface IAuditLogBulkExportJobCronService {
  crowi: Crowi;
  proceedBulkExportJob(
    auditLogBulkExportJob: AuditLogBulkExportJobDocument,
  ): void;
  notifyExportResultAndCleanUp(
    action: SupportedActionType,
    auditLogBulkExportJob: AuditLogBulkExportJobDocument,
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
      auditLogBulkExportJobInProgress.map((job) =>
        this.proceedBulkExportJob(job),
      ),
    );
  }

  async proceedBulkExportJob(
    auditLogBulkExportJob: AuditLogBulkExportJobDocument,
  ) {
    try {
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
        await compressAndUpload.bind(this)(auditLogBulkExportJob);
      }
    } catch (err) {
      logger.error(err);
    }
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
    // TODO: Implement cleanup process in a future task.
    // The following method `cleanUpExportJobResources` will be called here once it's ready.
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
