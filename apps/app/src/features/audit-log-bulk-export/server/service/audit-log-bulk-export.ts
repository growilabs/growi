import { createHash } from 'node:crypto';
import { getIdStringForRef } from '@growi/core';
import mongoose from 'mongoose';

import type { auditlogbulkexportjobs } from '~/generated/prisma/client';
import { prisma } from '~/utils/prisma';

import type {
  AuditLogBulkExportFormat,
  IAuditLogBulkExportFilters,
  IAuditLogBulkExportRequestFilters,
} from '../../interfaces/audit-log-bulk-export';
import {
  AuditLogBulkExportJobInProgressJobStatus,
  AuditLogBulkExportJobStatus,
} from '../../interfaces/audit-log-bulk-export';

export interface IAuditLogBulkExportService {
  createOrResetExportJob: (
    requestFilters: IAuditLogBulkExportRequestFilters,
    format: AuditLogBulkExportFormat,
    currentUser,
    restartJob?: boolean,
  ) => Promise<string>;
  resetExportJob: (job: auditlogbulkexportjobs) => Promise<void>;
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
  duplicateJob: auditlogbulkexportjobs;

  constructor(duplicateJob: auditlogbulkexportjobs) {
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
    requestFilters: IAuditLogBulkExportRequestFilters,
    format: AuditLogBulkExportFormat,
    currentUser,
    restartJob?: boolean,
  ): Promise<string> {
    const filters: IAuditLogBulkExportFilters = {
      // Prisma rejects null for the `actions String[]` composite field.
      actions: requestFilters.actions ?? [],
      dateFrom: requestFilters.dateFrom,
      dateTo: requestFilters.dateTo,
    };
    if (requestFilters.usernames?.length) {
      const User = mongoose.model('User');
      const userIds = await User.find({
        username: { $in: requestFilters.usernames },
      }).distinct('_id');
      filters.users = userIds;
    }

    const normalizedFilters = canonicalizeFilters(filters);
    const filterHash = sha256(JSON.stringify(normalizedFilters));

    const duplicateInProgress = await prisma.auditlogbulkexportjobs.findFirst({
      where: {
        userId: getIdStringForRef(currentUser),
        filterHash,
        status: { in: Object.values(AuditLogBulkExportJobInProgressJobStatus) },
      },
    });

    if (duplicateInProgress != null) {
      if (restartJob) {
        await this.resetExportJob(duplicateInProgress);
        return duplicateInProgress.id;
      }
      throw new DuplicateAuditLogBulkExportJobError(duplicateInProgress);
    }

    const createdJob = await prisma.auditlogbulkexportjobs.create({
      data: {
        userId: getIdStringForRef(currentUser),
        filters: {
          users: filters.users?.map(getIdStringForRef),
          actions: filters.actions,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
        },
        filterHash,
        format,
        status: AuditLogBulkExportJobStatus.exporting,
        totalExportedCount: 0,
      },
    });
    return createdJob.id;
  }

  /**
   * Reset audit-log export job in progress
   */
  async resetExportJob(job: auditlogbulkexportjobs): Promise<void> {
    await prisma.auditlogbulkexportjobs.update({
      where: { id: job.id },
      data: { restartFlag: true },
    });
  }
}

export const auditLogBulkExportService = new AuditLogBulkExportService(); // singleton
