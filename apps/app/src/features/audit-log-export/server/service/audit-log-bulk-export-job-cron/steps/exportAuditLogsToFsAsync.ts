import fs from 'fs';
import path from 'path';
import { pipeline, Writable } from 'stream';

import {
  AuditLogExportJobStatus,
} from '~/features/audit-log-export/interfaces/audit-log-bulk-export';
import type { AuditLogExportJobDocument } from '../../../models/audit-log-bulk-export-job';

import type { IAuditLogExportJobCronService } from '..';
import Activity, { type ActivityDocument } from '~/server/models/activity';

const MAX_LOGS_PER_FILE = 10; // 1ファイルあたりの件数上限

/**
 * Get a Writable that writes audit logs to JSON files
 */
function getAuditLogWritable(
    this: IAuditLogExportJobCronService,
    job: AuditLogExportJobDocument,
): Writable {
  const outputDir = this.getTmpOutputDir(job);
  let buffer: any[] = [];
  let fileIndex = 0;

  return new Writable({
    objectMode: true,
    write: async(log: ActivityDocument, encoding, callback) => {
      try {
        buffer.push(log);

        if (buffer.length >= MAX_LOGS_PER_FILE) {
          const filePath = path.join(
            outputDir,
            `audit-logs-${String(fileIndex).padStart(2, '0')}.json`,
          );
          await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
          await fs.promises.writeFile(filePath, JSON.stringify(buffer, null, 2));
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
            `audit-logs-${String(fileIndex).padStart(2, '0')}.json`,
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
  const query: any = {};

  if (filters.actions && filters.actions.length > 0) {
    query.action = { $in: filters.actions };
  }

const logsCursor = Activity.find(query)
    .sort({ createdAt: 1 })
    .lean()
    .cursor({ batchSize: this.pageBatchSize });

  const writable = getAuditLogWritable.bind(this)(job);

  this.setStreamInExecution(job._id, logsCursor);

  pipeline(logsCursor, writable, (err) => {
    this.handleError(err, job);
  });
}
