import fs from 'fs';
import path from 'path';
import { pipeline, Writable } from 'stream';

import type { IUser } from '@growi/core';
import mongoose, { type FilterQuery } from 'mongoose';

import {
  AuditLogExportJobStatus,
} from '~/features/audit-log-export/interfaces/audit-log-bulk-export';
import Activity, { type ActivityDocument } from '~/server/models/activity';
import loggerFactory from '~/utils/logger';

import type { IAuditLogExportJobCronService } from '..';
import type { AuditLogExportJobDocument } from '../../../models/audit-log-bulk-export-job';


const MAX_LOGS_PER_FILE = 10; // 1ファイルあたりの件数上限

const logger = loggerFactory('growi:audit-log-export:exportAuditLogsToFsAsync');

/**
 * Get a Writable that writes audit logs to JSON files
 */
function getAuditLogWritable(
    this: IAuditLogExportJobCronService,
    job: AuditLogExportJobDocument,
): Writable {
  const outputDir = this.getTmpOutputDir(job);
  let buffer: ActivityDocument[] = [];
  let fileIndex = 0;

  return new Writable({
    objectMode: true,
    write: async(log: ActivityDocument, encoding, callback) => {
      try {
        buffer.push(log);

        // Update lastExportedId for resumability
        job.lastExportedId = log._id.toString();
        job.totalExportedCount = (job.totalExportedCount || 0) + 1;

        if (buffer.length >= MAX_LOGS_PER_FILE) {
          const filePath = path.join(
            outputDir,
            `audit-logs-${job._id.toString()}-${String(fileIndex).padStart(2, '0')}.json`,
          );
          await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
          await fs.promises.writeFile(filePath, JSON.stringify(buffer, null, 2));

          // Save progress after each file
          await job.save();

          buffer = [];
          fileIndex++;
        }
      }
      catch (err) {
        callback(err as Error);
        return;
      }
      callback();
    },
    final: async(callback) => {
      try {
        if (buffer.length > 0) {
          const filePath = path.join(
            outputDir,
            `audit-logs-${job._id.toString()}-${String(fileIndex).padStart(2, '0')}.json`,
          );
          await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
          await fs.promises.writeFile(filePath, JSON.stringify(buffer, null, 2));
        }
        job.status = AuditLogExportJobStatus.uploading;
        job.lastExportedAt = new Date();
        await job.save();
      }
      catch (err) {
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
    this: IAuditLogExportJobCronService,
    job: AuditLogExportJobDocument,
): Promise<void> {
  const filters = job.filters ?? {};
  const query: FilterQuery<ActivityDocument> = {};

  if (filters.actions && filters.actions.length > 0) {
    query.action = { $in: filters.actions };
  }

  // Add date range filters
  if (filters.dateFrom || filters.dateTo) {
    query.createdAt = {};
    if (filters.dateFrom) {
      query.createdAt.$gte = new Date(filters.dateFrom);
    }
    if (filters.dateTo) {
      query.createdAt.$lte = new Date(filters.dateTo);
    }
  }

  // Add user filters - convert usernames to ObjectIds
  if (filters.users && filters.users.length > 0) {
    logger.debug('Converting usernames to ObjectIds:', filters.users);
    const User = mongoose.model<IUser>('User');
    const userIds = await User.find({ username: { $in: filters.users } }).distinct('_id');

    logger.debug('Found user IDs:', userIds);

    if (userIds.length === 0) {
      // No users found with the specified usernames - this would result in no matching activities
      throw new Error(`No users found with usernames: ${filters.users.join(', ')}`);
    }

    query.user = { $in: userIds };
  }

  // Resume from lastExportedId if available
  if (job.lastExportedId) {
    query._id = { $gt: job.lastExportedId };
  }

  logger.debug('Final query for activity search:', JSON.stringify(query, null, 2));

  // Sort by _id for consistent ordering and resumability
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
