import type { HydratedDocument } from 'mongoose';

import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';
import CronService from '~/server/service/cron';
import loggerFactory from '~/utils/logger';

import {
  AuditLogExportJobInProgressStatus,
  AuditLogExportJobStatus,
} from '../../interfaces/audit-log-bulk-export';
import type { AuditLogExportJobDocument } from '../models/audit-log-bulk-export-job';
import AuditLogExportJob from '../models/audit-log-bulk-export-job';

import { auditLogExportJobCronService } from './audit-log-bulk-export-job-cron';

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
    return configManager.getConfig('app:auditLogBulkExportJobCleanUpCronSchedule');
  }

  override async executeJob(): Promise<void> {
    // Execute cleanup even if isAuditLogExportEnabled is false, to cleanup jobs which were created before audit log export was disabled
    logger.debug('Starting audit log export job cleanup');

    await this.deleteExpiredExportJobs();
    await this.deleteDownloadExpiredExportJobs();
    await this.deleteFailedExportJobs();

    logger.debug('Completed audit log export job cleanup');
  }

  /**
   * Delete audit log bulk export jobs which are on-going and has passed the limit time for execution
   */
  async deleteExpiredExportJobs() {
    const exportJobExpirationSeconds = configManager.getConfig(
      'app:bulkExportJobExpirationSeconds',
    );
    
    const thresholdDate = new Date(Date.now() - exportJobExpirationSeconds * 1000);
    
    const expiredExportJobs = await AuditLogExportJob.find({
      $or: Object.values(AuditLogExportJobInProgressStatus).map((status) => ({
        status,
      })),
      createdAt: {
        $lt: thresholdDate,
      },
    });

    logger.debug(`Found ${expiredExportJobs.length} expired audit log export jobs`);

    if (auditLogExportJobCronService != null) {
      await this.cleanUpAndDeleteBulkExportJobs(
        expiredExportJobs,
        auditLogExportJobCronService.cleanUpExportJobResources.bind(
          auditLogExportJobCronService,
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
    
    const downloadExpiredExportJobs = await AuditLogExportJob.find({
      status: AuditLogExportJobStatus.completed,
      completedAt: { $lt: thresholdDate },
    });

    logger.debug(`Found ${downloadExpiredExportJobs.length} download-expired audit log export jobs`);

    const cleanUp = async (job: AuditLogExportJobDocument) => {
      await auditLogExportJobCronService?.cleanUpExportJobResources(job);

      const hasSameAttachmentAndDownloadNotExpired =
        await AuditLogExportJob.findOne({
          attachment: job.attachment,
          _id: { $ne: job._id },
          completedAt: { $gte: thresholdDate },
        });
      if (hasSameAttachmentAndDownloadNotExpired == null) {
        // delete attachment if no other export job (which download has not expired) has re-used it
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
    const failedExportJobs = await AuditLogExportJob.find({
      status: AuditLogExportJobStatus.failed,
    });

    logger.debug(`Found ${failedExportJobs.length} failed audit log export jobs`);

    if (auditLogExportJobCronService != null) {
      await this.cleanUpAndDeleteBulkExportJobs(
        failedExportJobs,
        auditLogExportJobCronService.cleanUpExportJobResources.bind(
          auditLogExportJobCronService,
        ),
      );
    }
  }

  async cleanUpAndDeleteBulkExportJobs(
    auditLogBulkExportJobs: HydratedDocument<AuditLogExportJobDocument>[],
    cleanUp: (job: AuditLogExportJobDocument) => Promise<void>,
  ): Promise<void> {
    const results = await Promise.allSettled(
      auditLogBulkExportJobs.map((job) => cleanUp(job)),
    );
    results.forEach((result) => {
      if (result.status === 'rejected') logger.error(result.reason);
    });

    // Only batch delete jobs which have been successfully cleaned up
    // Clean up failed jobs will be retried in the next cron execution
    const cleanedUpJobs = auditLogBulkExportJobs.filter(
      (_, index) => results[index].status === 'fulfilled',
    );
    if (cleanedUpJobs.length > 0) {
      const cleanedUpJobIds = cleanedUpJobs.map((job) => job._id);
      await AuditLogExportJob.deleteMany({ _id: { $in: cleanedUpJobIds } });
      logger.debug(`Successfully deleted ${cleanedUpJobs.length} audit log export jobs`);
    }
  }
}

// eslint-disable-next-line import/no-mutable-exports
export let auditLogBulkExportJobCleanUpCronService:
  | AuditLogBulkExportJobCleanUpCronService
  | undefined; // singleton instance
export default function instanciate(crowi: Crowi): void {
  auditLogBulkExportJobCleanUpCronService = new AuditLogBulkExportJobCleanUpCronService(
    crowi,
  );
}
