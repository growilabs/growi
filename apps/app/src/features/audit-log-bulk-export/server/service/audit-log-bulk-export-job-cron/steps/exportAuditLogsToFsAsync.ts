import fs from 'node:fs';
import path from 'node:path';
import { pipeline, Readable, Writable } from 'node:stream';
import { getIdStringForRef } from '@growi/core';

import { AuditLogBulkExportJobStatus } from '~/features/audit-log-bulk-export/interfaces/audit-log-bulk-export';
import type { Prisma } from '~/generated/prisma/client';
import { SupportedAction } from '~/interfaces/activity';
import type { ActivityDocument } from '~/server/models/activity';
import { prisma } from '~/utils/prisma';

import type { AuditLogBulkExportJobDocument } from '../../../models/audit-log-bulk-export-job';
import type { IAuditLogBulkExportJobCronService } from '..';
import { exportActivityCursor } from './activity-export-cursor';

/**
 * Get a Writable that writes audit logs to JSON files
 */
function getAuditLogWritable(
  this: IAuditLogBulkExportJobCronService,
  job: AuditLogBulkExportJobDocument,
): Writable {
  const outputDir = this.getTmpOutputDir(job);
  let buffer: ActivityDocument[] = [];
  let fileIndex = 0;
  return new Writable({
    objectMode: true,
    write: async (log: ActivityDocument, _encoding, callback) => {
      try {
        buffer.push(log);

        // Update lastExportedId for resumability
        job.lastExportedId = log._id.toString();
        job.totalExportedCount = (job.totalExportedCount || 0) + 1;

        if (buffer.length >= this.maxLogsPerFile) {
          const filePath = path.join(
            outputDir,
            `audit-logs-${job._id.toString()}-${String(fileIndex).padStart(2, '0')}.json`,
          );
          await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
          await fs.promises.writeFile(
            filePath,
            JSON.stringify(buffer, null, 2),
          );

          await job.save();

          buffer = [];
          fileIndex++;
        }
      } catch (err) {
        callback(err as Error);
        return;
      }
      callback();
    },
    final: async (callback) => {
      try {
        if (buffer.length > 0) {
          const filePath = path.join(
            outputDir,
            `audit-logs-${job._id.toString()}-${String(fileIndex).padStart(2, '0')}.json`,
          );
          await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
          await fs.promises.writeFile(
            filePath,
            JSON.stringify(buffer, null, 2),
          );
        }
        job.status = AuditLogBulkExportJobStatus.uploading;
        await job.save();
      } catch (err) {
        callback(err as Error);
        return;
      }
      callback();
    },
  });
}

/**
 * Export audit logs to the file system before compressing and uploading.
 */
export async function exportAuditLogsToFsAsync(
  this: IAuditLogBulkExportJobCronService,
  job: AuditLogBulkExportJobDocument,
): Promise<void> {
  const filters = job.filters ?? {};

  // Build Prisma where filter from user-defined filters
  const where: Prisma.activitiesWhereInput = {};

  if (filters.actions && filters.actions.length > 0) {
    where.action = { in: filters.actions };
  }
  if (filters.dateFrom || filters.dateTo) {
    const createdAt: Prisma.DateTimeFilter<'activities'> = {};
    if (filters.dateFrom) {
      createdAt.gte = new Date(filters.dateFrom);
    }
    if (filters.dateTo) {
      createdAt.lte = new Date(filters.dateTo);
    }
    where.createdAt = createdAt;
  }
  if (filters.users && filters.users.length > 0) {
    // Normalize Ref<IUser> (ObjectId | IUser) to string IDs for Prisma
    where.userId = { in: filters.users.map(getIdStringForRef) };
  }

  // Check whether any matching documents exist (replaces Activity.exists(query)).
  // The original exists(query) was called with the resume constraint already
  // merged into query, so it answered "are there docs remaining AFTER the resume
  // point (lastExportedId)?". Apply the same id > lastExportedId constraint here to
  // preserve that semantics; otherwise a resume with nothing left would wrongly run
  // an empty export instead of completing with NO_RESULTS.
  const hasAnyWhere: Prisma.activitiesWhereInput =
    job.lastExportedId != null
      ? { ...where, id: { gt: job.lastExportedId } }
      : where;
  const hasAny =
    (await prisma.activities.findFirst({
      where: hasAnyWhere,
      select: { id: true },
    })) != null;

  if (!hasAny) {
    job.totalExportedCount = 0;
    job.status = AuditLogBulkExportJobStatus.completed;
    job.lastExportedId = undefined;
    await job.save();

    await this.notifyExportResultAndCleanUp(
      SupportedAction.ACTION_AUDIT_LOG_BULK_EXPORT_NO_RESULTS,
      job,
    );
    return;
  }

  // Build a Readable from the cursor executor (replaces Activity.find().cursor()).
  // Resume semantics: if job.lastExportedId is set, pass it as startAfterId so
  // the first batch starts after the last-exported document (id > lastExportedId),
  // preserving the same resume behaviour as the former Mongoose _id: { $gt: ... }.
  const logsReadable = Readable.from(
    exportActivityCursor(prisma, where, this.pageBatchSize, job.lastExportedId),
  );

  const writable = getAuditLogWritable.bind(this)(job);

  this.setStreamInExecution(job._id, logsReadable);

  pipeline(logsReadable, writable, (err) => {
    this.handleError(err, job);
  });
}
