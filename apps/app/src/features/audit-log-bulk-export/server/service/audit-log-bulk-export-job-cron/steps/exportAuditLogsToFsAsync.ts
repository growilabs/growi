import fs from 'node:fs';
import path from 'node:path';
import { pipeline, Writable } from 'node:stream';
import type { IUser } from '@growi/core';
import mongoose, { type FilterQuery } from 'mongoose';

import { AuditLogBulkExportJobStatus } from '~/features/audit-log-bulk-export/interfaces/audit-log-bulk-export';
import { SupportedAction } from '~/interfaces/activity';
import Activity, { type ActivityDocument } from '~/server/models/activity';

import type { AuditLogBulkExportJobDocument } from '../../../models/audit-log-bulk-export-job';
import type { IAuditLogBulkExportJobCronService } from '..';

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
  const query: FilterQuery<ActivityDocument> = {};

  // Build query filters for searching activity logs based on user-defined filters
  if (filters.actions && filters.actions.length > 0) {
    query.action = { $in: filters.actions };
  }
  if (filters.dateFrom || filters.dateTo) {
    query.createdAt = {};
    if (filters.dateFrom) {
      query.createdAt.$gte = new Date(filters.dateFrom);
    }
    if (filters.dateTo) {
      query.createdAt.$lte = new Date(filters.dateTo);
    }
  }
  if (filters.users && filters.users.length > 0) {
    const User = mongoose.model<IUser>('User');
    const userIds = await User.find({
      _id: { $in: filters.users },
    }).distinct('_id');
    if (userIds.length === 0) {
      throw new Error(
        `No users found with userIDs: ${filters.users.join(', ')}`,
      );
    }
    query.user = { $in: userIds };
  }

  // If the previous export was incomplete, resume from the last exported ID by adding it to the query filter
  if (job.lastExportedId) {
    query._id = { $gt: job.lastExportedId };
  }

  const hasAny = await Activity.exists(query);
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

  const logsCursor = Activity.find(query)

    .sort({ _id: 1 })
    .lean()
    .cursor({ batchSize: this.pageBatchSize });

  const writable = getAuditLogWritable.bind(this)(job);

  this.setStreamInExecution(job._id, logsCursor);

  pipeline(logsCursor, writable, (err) => {
    this.handleError(err, job);
  });
}
