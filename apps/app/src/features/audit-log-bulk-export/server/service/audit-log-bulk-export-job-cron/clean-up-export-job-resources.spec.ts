import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import loggerFactory from '~/utils/logger';

import type { AuditLogBulkExportJobDocument } from '../../models/audit-log-bulk-export-job';
import {
  AuditLogBulkExportJobExpiredError,
  AuditLogBulkExportJobRestartedError,
} from './errors';
import type { IAuditLogBulkExportJobCronService } from './index';

const logger = loggerFactory('growi:appSettings');

/**
 * Create a minimal mock of the cron service for testing cleanUpExportJobResources
 */
function createMockCronService(): IAuditLogBulkExportJobCronService & {
  cleanUpExportJobResources: (
    job: AuditLogBulkExportJobDocument,
    restarted?: boolean,
  ) => Promise<void>;
} {
  const streamInExecutionMemo: Record<string, NodeJS.ReadableStream> = {};

  return {
    crowi: {} as any,
    activityEvent: {} as any,
    tmpOutputRootDir: '',
    pageBatchSize: 100,
    maxLogsPerFile: 50,
    compressFormat: 'zip',
    compressLevel: 6,

    getTmpOutputDir(job: AuditLogBulkExportJobDocument): string {
      return path.join(this.tmpOutputRootDir, job._id.toString());
    },

    getStreamInExecution(
      jobId: Types.ObjectId,
    ): NodeJS.ReadableStream | undefined {
      return streamInExecutionMemo[jobId.toString()];
    },

    setStreamInExecution(
      jobId: Types.ObjectId,
      stream: NodeJS.ReadableStream,
    ): void {
      streamInExecutionMemo[jobId.toString()] = stream;
    },

    removeStreamInExecution(jobId: Types.ObjectId): void {
      delete streamInExecutionMemo[jobId.toString()];
    },

    async cleanUpExportJobResources(
      job: AuditLogBulkExportJobDocument,
      restarted = false,
    ): Promise<void> {
      const streamInExecution = this.getStreamInExecution(job._id);
      if (streamInExecution != null) {
        if (restarted) {
          (streamInExecution as PassThrough).destroy(
            new AuditLogBulkExportJobRestartedError(),
          );
        } else {
          (streamInExecution as PassThrough).destroy(
            new AuditLogBulkExportJobExpiredError(),
          );
        }
        this.removeStreamInExecution(job._id);
      }

      const promises = [
        fs.promises.rm(this.getTmpOutputDir(job), {
          recursive: true,
          force: true,
        }),
      ];

      const results = await Promise.allSettled(promises);
      results.forEach((result) => {
        if (result.status === 'rejected') {
          logger.error(result.reason);
        }
      });
    },

    // Stubs for other interface methods
    async proceedBulkExportJob(): Promise<void> {},
    async handleError(): Promise<void> {},
    async notifyExportResultAndCleanUp(): Promise<void> {},
  };
}

/**
 * Create a mock job document
 */
function createMockJob(id?: string): AuditLogBulkExportJobDocument {
  return {
    _id: new Types.ObjectId(id),
  } as AuditLogBulkExportJobDocument;
}

describe('cleanUpExportJobResources', () => {
  let cronService: ReturnType<typeof createMockCronService>;
  let testTmpDir: string;

  beforeEach(() => {
    cronService = createMockCronService();
    testTmpDir = fs.mkdtempSync(path.join('/tmp', 'cleanup-test-'));
    cronService.tmpOutputRootDir = testTmpDir;
  });

  afterEach(() => {
    if (fs.existsSync(testTmpDir)) {
      fs.rmSync(testTmpDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  describe('Temporary Directory Deletion', () => {
    it('should delete tmp directory after cleanup', async () => {
      const job = createMockJob();

      // Create dummy files in tmp directory
      const tmpDir = cronService.getTmpOutputDir(job);
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'dummy.json'), '{"test": true}');

      // Verify files exist before cleanup
      expect(fs.existsSync(tmpDir)).toBe(true);
      expect(fs.readdirSync(tmpDir)).toContain('dummy.json');

      // Execute cleanup
      await cronService.cleanUpExportJobResources(job);

      // Verify directory is deleted
      expect(fs.existsSync(tmpDir)).toBe(false);
    });

    it('should delete multiple files in tmp directory', async () => {
      const job = createMockJob();

      // Create multiple dummy files
      const tmpDir = cronService.getTmpOutputDir(job);
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'audit-logs-00.json'), '[]');
      fs.writeFileSync(path.join(tmpDir, 'audit-logs-01.json'), '[]');
      fs.writeFileSync(path.join(tmpDir, 'audit-logs-02.json'), '[]');

      expect(fs.readdirSync(tmpDir).length).toBe(3);

      await cronService.cleanUpExportJobResources(job);

      expect(fs.existsSync(tmpDir)).toBe(false);
    });
  });

  describe('Stream Destruction', () => {
    // restarted=false の場合、ExpiredError でストリームを破棄すべきである
    it('should destroy stream with ExpiredError when restarted=false', async () => {
      const job = createMockJob();

      // Create a mock stream and set it
      const mockStream = new PassThrough();
      mockStream.on('error', () => {}); // Prevent unhandled error
      const destroySpy = vi.spyOn(mockStream, 'destroy');
      cronService.setStreamInExecution(job._id, mockStream);

      // Execute cleanup with restarted=false
      await cronService.cleanUpExportJobResources(job, false);

      // Verify stream was destroyed with ExpiredError
      expect(destroySpy).toHaveBeenCalledTimes(1);
      expect(destroySpy.mock.calls[0][0]).toBeInstanceOf(
        AuditLogBulkExportJobExpiredError,
      );

      // Verify stream is removed from memo
      expect(cronService.getStreamInExecution(job._id)).toBeUndefined();
    });

    it('should destroy stream with RestartedError when restarted=true', async () => {
      const job = createMockJob();

      // Create a mock stream and set it
      const mockStream = new PassThrough();
      mockStream.on('error', () => {}); // Prevent unhandled error
      const destroySpy = vi.spyOn(mockStream, 'destroy');
      cronService.setStreamInExecution(job._id, mockStream);

      // Execute cleanup with restarted=true
      await cronService.cleanUpExportJobResources(job, true);

      // Verify stream was destroyed with RestartedError
      expect(destroySpy).toHaveBeenCalledTimes(1);
      expect(destroySpy.mock.calls[0][0]).toBeInstanceOf(
        AuditLogBulkExportJobRestartedError,
      );

      // Verify stream is removed from memo
      expect(cronService.getStreamInExecution(job._id)).toBeUndefined();
    });
    it('should remove stream from memo after destruction', async () => {
      const job = createMockJob();

      const mockStream = new PassThrough();
      mockStream.on('error', () => {}); // Prevent unhandled error
      cronService.setStreamInExecution(job._id, mockStream);

      // Verify stream exists before cleanup
      expect(cronService.getStreamInExecution(job._id)).toBe(mockStream);

      await cronService.cleanUpExportJobResources(job);

      // Verify stream is removed
      expect(cronService.getStreamInExecution(job._id)).toBeUndefined();
    });
  });

  describe('Combined Cleanup', () => {
    it('should cleanup both stream and directory', async () => {
      const job = createMockJob();

      // Setup: create stream and directory
      const mockStream = new PassThrough();
      mockStream.on('error', () => {}); // Prevent unhandled error
      const destroySpy = vi.spyOn(mockStream, 'destroy');
      cronService.setStreamInExecution(job._id, mockStream);

      const tmpDir = cronService.getTmpOutputDir(job);
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'test.json'), '{}');

      // Execute cleanup
      await cronService.cleanUpExportJobResources(job);

      // Verify both are cleaned up
      expect(destroySpy).toHaveBeenCalledTimes(1);
      expect(cronService.getStreamInExecution(job._id)).toBeUndefined();
      expect(fs.existsSync(tmpDir)).toBe(false);
    });
  });
});
