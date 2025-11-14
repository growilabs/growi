import type { HydratedDocument } from 'mongoose';

import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';
import CronService from '~/server/service/cron';
import loggerFactory from '~/utils/logger';

import {
  AuditLogBulkExportJobInProgressJobStatus,
  AuditLogBulkExportJobStatus,
} from '../../interfaces/audit-log-bulk-export';
import type { AuditLogBulkExportJobDocument } from '../models/audit-log-bulk-export-job';
import AuditLogBulkExportJob from '../models/audit-log-bulk-export-job';

import { auditLogBulkExportJobCronService } from './audit-log-bulk-export-job-cron';

const logger = loggerFactory(
  'growi:service:audit-log-bulk-export-job-clean-up-cron',
);

/**
 * Manages cronjob which deletes unnecessary audit log bulk export jobs
 */
class AuditLogBulkExportJobCleanUpCronService extends CronService {
  crowi: Crowi;

  constructor(crowi: Crowi) {
    super();
    this.crowi = crowi;
  }

  override getCronSchedule(): string {
    return '0 */6 * * *';
  }

  override async executeJob(): Promise<void> {
    await this.deleteExpiredExportJobs();
    await this.deleteDownloadExpiredExportJobs();
    await this.deleteFailedExportJobs();
  }

  /**
   * Delete audit log bulk export jobs which are on-going and has passed the limit time for execution
   */
  async deleteExpiredExportJobs() {
    const exportJobExpirationSeconds = configManager.getConfig(
      'app:bulkExportJobExpirationSeconds',
    );

    const thresholdDate = new Date(
      Date.now() - exportJobExpirationSeconds * 1000,
    );

    const expiredExportJobs = await AuditLogBulkExportJob.find({
      $or: Object.values(AuditLogBulkExportJobInProgressJobStatus).map(
        (status) => ({
          status,
        }),
      ),
      createdAt: {
        $lt: thresholdDate,
      },
    });

    if (auditLogBulkExportJobCronService != null) {
      await this.cleanUpAndDeleteBulkExportJobs(
        expiredExportJobs,
        auditLogBulkExportJobCronService.cleanUpExportJobResources.bind(
          auditLogBulkExportJobCronService,
        ),
      );
    }
  }

  /**
   * Delete audit log bulk export jobs which have completed but the due time for downloading has passed
   */
  async deleteDownloadExpiredExportJobs() {
    const downloadExpirationSeconds = configManager.getConfig(
      'app:bulkExportDownloadExpirationSeconds',
    );
    const thresholdDate = new Date(
      Date.now() - downloadExpirationSeconds * 1000,
    );

    const downloadExpiredExportJobs = await AuditLogBulkExportJob.find({
      status: AuditLogBulkExportJobStatus.completed,
      completedAt: { $lt: thresholdDate },
    });

    const cleanUp = async (job: AuditLogBulkExportJobDocument) => {
      await auditLogBulkExportJobCronService?.cleanUpExportJobResources(job);

      const hasSameAttachmentAndDownloadNotExpired =
        await AuditLogBulkExportJob.findOne({
          attachment: job.attachment,
          _id: { $ne: job._id },
          completedAt: { $gte: thresholdDate },
        });
      if (hasSameAttachmentAndDownloadNotExpired == null) {
        await this.crowi.attachmentService?.removeAttachment(job.attachment);
      }
    };

    await this.cleanUpAndDeleteBulkExportJobs(
      downloadExpiredExportJobs,
      cleanUp,
    );
  }

  /**
   * Delete audit log bulk export jobs which have failed
   */
  async deleteFailedExportJobs() {
    const failedExportJobs = await AuditLogBulkExportJob.find({
      status: AuditLogBulkExportJobStatus.failed,
    });

    if (auditLogBulkExportJobCronService != null) {
      await this.cleanUpAndDeleteBulkExportJobs(
        failedExportJobs,
        auditLogBulkExportJobCronService.cleanUpExportJobResources.bind(
          auditLogBulkExportJobCronService,
        ),
      );
    }
  }

  async cleanUpAndDeleteBulkExportJobs(
    auditLogBulkExportJobs: HydratedDocument<AuditLogBulkExportJobDocument>[],
    cleanUp: (job: AuditLogBulkExportJobDocument) => Promise<void>,
  ): Promise<void> {
    const results = await Promise.allSettled(
      auditLogBulkExportJobs.map((job) => cleanUp(job)),
    );
    results.forEach((result) => {
      if (result.status === 'rejected') logger.error(result.reason);
    });

    const cleanedUpJobs = auditLogBulkExportJobs.filter(
      (_, index) => results[index].status === 'fulfilled',
    );
    if (cleanedUpJobs.length > 0) {
      const cleanedUpJobIds = cleanedUpJobs.map((job) => job._id);
      await AuditLogBulkExportJob.deleteMany({ _id: { $in: cleanedUpJobIds } });
    }
  }
}

export let auditLogBulkExportJobCleanUpCronService:
  | AuditLogBulkExportJobCleanUpCronService
  | undefined;
export default function instantiate(crowi: Crowi): void {
  auditLogBulkExportJobCleanUpCronService =
    new AuditLogBulkExportJobCleanUpCronService(crowi);
}
