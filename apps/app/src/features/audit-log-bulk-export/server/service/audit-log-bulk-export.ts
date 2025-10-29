import { createHash } from 'node:crypto';

import type {
  AuditLogBulkExportFormat,
  IAuditLogBulkExportFilters,
} from '../../interfaces/audit-log-bulk-export';
import {
  AuditLogBulkExportJobInProgressJobStatus,
  AuditLogBulkExportJobStatus,
} from '../../interfaces/audit-log-bulk-export';
import type { AuditLogBulkExportJobDocument } from '../models/audit-log-bulk-export-job';
import AuditLogBulkExportJob from '../models/audit-log-bulk-export-job';

export interface IAuditLogBulkExportService {
  createOrResetExportJob: (
    filters: IAuditLogBulkExportFilters,
    format: AuditLogBulkExportFormat,
    currentUser,
    restartJob?: boolean,
  ) => Promise<string>;
  resetExportJob: (job: AuditLogBulkExportJobDocument) => Promise<void>;
}

/** ============================== utils ============================== */

/**
 * Normalizes filter values to ensure that logically equivalent filters,
 * regardless of order or formatting differences, generate the same hash.
 */
function canonicalizeFilters(filters: IAuditLogBulkExportFilters) {
  const normalized: Record<string, unknown> = {};

  if (filters.users?.length) {
    normalized.users = filters.users.map(String).sort();
  }
  if (filters.actions?.length) {
    normalized.actions = [...filters.actions].sort();
  }
  if (filters.dateFrom) {
    normalized.dateFrom = new Date(filters.dateFrom).toISOString();
  }
  if (filters.dateTo) {
    normalized.dateTo = new Date(filters.dateTo).toISOString();
  }
  return normalized;
}

/**
 * Generates a SHA-256 hash used to uniquely identify a set of filters.
 * Requests with the same input produce the same hash value,
 * preventing duplicate audit-log export jobs from being executed.
 */
function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** ============================== error ============================== */

export class DuplicateAuditLogBulkExportJobError extends Error {
  duplicateJob: AuditLogBulkExportJobDocument;

  constructor(duplicateJob: AuditLogBulkExportJobDocument) {
    super('Duplicate audit-log bulk export job is in progress');
    this.duplicateJob = duplicateJob;
  }
}

/** ============================== service ============================== */

class AuditLogBulkExportService implements IAuditLogBulkExportService {
  /**
   * Create a new audit-log bulk export job or reset the existing one
   */
  async createOrResetExportJob(
    filters: IAuditLogBulkExportFilters,
    format: AuditLogBulkExportFormat,
    currentUser,
    restartJob?: boolean,
  ): Promise<string> {
    const normalizedFilters = canonicalizeFilters(filters);
    const filterHash = sha256(JSON.stringify(normalizedFilters));

    const duplicateInProgress: AuditLogBulkExportJobDocument | null =
      await AuditLogBulkExportJob.findOne({
        user: { $eq: currentUser },
        filterHash,
        $or: Object.values(AuditLogBulkExportJobInProgressJobStatus).map(
          (status) => ({ status }),
        ),
      });

    if (duplicateInProgress != null) {
      if (restartJob) {
        await this.resetExportJob(duplicateInProgress);
        return duplicateInProgress._id.toString();
      }
      throw new DuplicateAuditLogBulkExportJobError(duplicateInProgress);
    }

    const createdJob = await AuditLogBulkExportJob.create({
      user: currentUser,
      filters: normalizedFilters,
      filterHash,
      format,
      status: AuditLogBulkExportJobStatus.exporting,
      totalExportedCount: 0,
    });
    return createdJob._id.toString();
  }

  /**
   * Reset audit-log export job in progress
   */
  async resetExportJob(job: AuditLogBulkExportJobDocument): Promise<void> {
    job.restartFlag = true;
    await job.save();
  }
}

export const auditLogBulkExportService = new AuditLogBulkExportService(); // singleton
