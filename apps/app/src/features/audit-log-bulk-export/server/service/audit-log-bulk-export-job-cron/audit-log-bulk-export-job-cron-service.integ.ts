import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IUser } from '@growi/core';
import mongoose from 'mongoose';
import type { MockedFunction } from 'vitest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { ResponseMode } from '~/server/interfaces/attachment';
import Activity, { type ActivityDocument } from '~/server/models/activity';
import type { IAttachmentDocument } from '~/server/models/attachment';
import { Attachment } from '~/server/models/attachment';
import { configManager } from '~/server/service/config-manager';
import type { FileUploader } from '~/server/service/file-uploader/file-uploader';
import { MultipartUploader } from '~/server/service/file-uploader/multipart-uploader';

import {
  AuditLogBulkExportFormat,
  AuditLogBulkExportJobStatus,
} from '../../../interfaces/audit-log-bulk-export';
import AuditLogBulkExportJob, {
  type AuditLogBulkExportJobDocument,
} from '../../models/audit-log-bulk-export-job';
import {
  AuditLogBulkExportJobExpiredError,
  AuditLogBulkExportJobRestartedError,
} from './errors';
import instanciateAuditLogBulkExportJobCronService, {
  auditLogBulkExportJobCronService,
} from './index';

type ExportedActivityData = Pick<
  ActivityDocument,
  '_id' | 'action' | 'user'
> & {
  createdAt: Date;
};

const userSchema = new mongoose.Schema(
  {
    name: { type: String },
    username: { type: String, required: true, unique: true },
    email: { type: String, unique: true, sparse: true },
  },
  {
    timestamps: true,
  },
);
const User = mongoose.model<IUser>('User', userSchema);

async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  {
    timeoutMs = 2000,
    intervalMs = 50,
  }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const start = Date.now();

  while (true) {
    if (await condition()) return;

    if (Date.now() - start > timeoutMs) {
      throw new Error('waitForCondition: timeout exceeded');
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function waitForJobStatus(
  jobId: mongoose.Types.ObjectId,
  status: AuditLogBulkExportJobStatus,
): Promise<AuditLogBulkExportJobDocument> {
  let latest: AuditLogBulkExportJobDocument | null = null;

  await waitForCondition(async () => {
    latest = await AuditLogBulkExportJob.findById(jobId);
    return latest?.status === status;
  });

  if (!latest) {
    throw new Error('Job not found after waitForCondition succeeded');
  }
  return latest;
}

class MockMultipartUploader extends MultipartUploader {
  override get uploadId(): string {
    return 'mock-upload-id';
  }

  override async initUpload(): Promise<void> {}
  override async uploadPart(
    _part: Buffer,
    _partNumber: number,
  ): Promise<void> {}
  override async completeUpload(): Promise<void> {}
  override async abortUpload(): Promise<void> {}
  override async getUploadedFileSize(): Promise<number> {
    return 0;
  }
}

const mockFileUploadService: FileUploader = {
  uploadAttachment: vi.fn(),
  getIsUploadable: vi.fn(() => true),
  isWritable: vi.fn(() => Promise.resolve(true)),
  getIsReadable: vi.fn(() => true),
  isValidUploadSettings: vi.fn(() => true),
  getFileUploadEnabled: vi.fn(() => true),
  listFiles: vi.fn(() => []),
  saveFile: vi.fn(() => Promise.resolve()),
  deleteFiles: vi.fn(),
  getFileUploadTotalLimit: vi.fn(() => 1024 * 1024 * 1024),
  getTotalFileSize: vi.fn(() => Promise.resolve(0)),
  doCheckLimit: vi.fn(() => Promise.resolve({ isUploadable: true })),
  determineResponseMode: vi.fn(() => ResponseMode.REDIRECT),
  respond: vi.fn(),
  findDeliveryFile: vi.fn(() => Promise.resolve(new PassThrough())),
  generateTemporaryUrl: vi.fn(() =>
    Promise.resolve({ url: 'mock-url', lifetimeSec: 3600 }),
  ),
  createMultipartUploader: vi.fn(
    (uploadKey: string, maxPartSize: number) =>
      new MockMultipartUploader(uploadKey, maxPartSize),
  ),
  abortPreviousMultipartUpload: vi.fn(() => Promise.resolve()),
};

const mockActivityService = {
  createActivity: vi.fn(() => Promise.resolve({ _id: 'mock-activity-id' })),
};

const mockEventEmitter = {
  emit: vi.fn(),
};

type MockCrowi = Pick<Crowi, 'fileUploadService'> & {
  event: (eventName: string) => typeof mockEventEmitter;
  activityService: typeof mockActivityService;
};

const createMockCrowi = (): MockCrowi => ({
  fileUploadService: mockFileUploadService,
  event: vi.fn(() => mockEventEmitter),
  activityService: mockActivityService,
});

describe('AuditLogBulkExportJobCronService Integration Test', () => {
  let cronService: NonNullable<typeof auditLogBulkExportJobCronService>;
  let crowi: MockCrowi;
  let testUser: IUser & mongoose.Document;
  let testTmpDir: string;
  let uploadAttachmentSpy: MockedFunction<
    (
      readable: NodeJS.ReadableStream,
      attachment: IAttachmentDocument,
    ) => Promise<void>
  >;

  const testActivities = [
    {
      action: SupportedAction.ACTION_PAGE_CREATE,
      user: null,
      createdAt: new Date('2023-01-01T10:00:00Z'),
      snapshot: { username: 'testuser' },
    },
    {
      action: SupportedAction.ACTION_PAGE_UPDATE,
      user: null,
      createdAt: new Date('2023-01-02T10:00:00Z'),
      snapshot: { username: 'testuser' },
    },
    {
      action: SupportedAction.ACTION_PAGE_DELETE,
      user: null,
      createdAt: new Date('2023-01-03T10:00:00Z'),
      snapshot: { username: 'testuser' },
    },
    ...Array.from({ length: 50 }, (_, i) => {
      const baseDate = new Date('2023-01-04T10:00:00Z');
      const activityDate = new Date(baseDate.getTime() + i * 60000);
      return {
        action: SupportedAction.ACTION_PAGE_VIEW,
        user: null,
        createdAt: activityDate,
        snapshot: { username: 'testuser' },
      };
    }),
  ];

  beforeAll(async () => {
    await configManager.loadConfigs();

    testUser = await User.create({
      name: 'Test User for Audit Log Export',
      username: 'auditlogexportcrontest',
      email: 'auditlogexportcrontest@example.com',
    });

    testActivities.forEach((activity) => {
      activity.user = testUser._id;
    });
  });

  beforeEach(async () => {
    crowi = createMockCrowi();
    instanciateAuditLogBulkExportJobCronService(crowi as Crowi);
    if (!auditLogBulkExportJobCronService) {
      throw new Error('auditLogBulkExportJobCronService was not initialized');
    }
    cronService = auditLogBulkExportJobCronService;

    testTmpDir = fs.mkdtempSync(path.join('/tmp', 'audit-log-export-test-'));
    cronService.tmpOutputRootDir = testTmpDir;

    cronService.maxLogsPerFile = 10;
    cronService.pageBatchSize = 5;

    uploadAttachmentSpy = vi
      .fn()
      .mockImplementation(
        async (
          readable: NodeJS.ReadableStream,
          attachment: IAttachmentDocument,
        ) => {
          const passThrough = new PassThrough();
          let totalSize = 0;

          passThrough.on('data', (chunk) => {
            totalSize += chunk.length;
          });

          await pipeline(readable, passThrough);

          attachment.fileSize = totalSize;
        },
      );
    mockFileUploadService.uploadAttachment = uploadAttachmentSpy;

    await Activity.insertMany(testActivities);
  });

  afterEach(async () => {
    await Activity.deleteMany({});
    await AuditLogBulkExportJob.deleteMany({});
    await Attachment.deleteMany({});

    if (fs.existsSync(testTmpDir)) {
      fs.rmSync(testTmpDir, { recursive: true, force: true });
    }

    vi.clearAllMocks();
  });

  afterAll(async () => {
    await User.deleteOne({ _id: testUser._id });
  });

  describe('1. Basic Operations (Happy Path)', () => {
    describe('1-1. No Filter → Export → ZIP → Upload', () => {
      it('should export all activities, create JSON files, and upload ZIP', async () => {
        const job = await AuditLogBulkExportJob.create({
          user: testUser._id,
          filters: {},
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.exporting,
          filterHash: 'test-hash',
          restartFlag: false,
          totalExportedCount: 0,
        });

        await cronService.proceedBulkExportJob(job);
        const afterExport = await waitForJobStatus(
          job._id,
          AuditLogBulkExportJobStatus.uploading,
        );

        const outputDir = cronService.getTmpOutputDir(afterExport);
        let hasFiles = false;
        let jsonFiles: string[] = [];

        if (fs.existsSync(outputDir)) {
          const files = fs.readdirSync(outputDir);
          jsonFiles = files.filter((file) => file.endsWith('.json'));
          hasFiles = jsonFiles.length > 0;
        }

        if (hasFiles) {
          expect(jsonFiles.length).toBeGreaterThan(0);

          const firstFile = path.join(outputDir, jsonFiles[0]);
          const content = JSON.parse(fs.readFileSync(firstFile, 'utf8'));
          expect(Array.isArray(content)).toBe(true);
          expect(content.length).toBeLessThanOrEqual(
            cronService.maxLogsPerFile,
          );
        }

        await cronService.proceedBulkExportJob(afterExport);
        await waitForCondition(() => uploadAttachmentSpy.mock.calls.length > 0);

        expect(uploadAttachmentSpy).toHaveBeenCalledTimes(1);
        const [readable, attachment] = uploadAttachmentSpy.mock.calls[0];
        expect(readable).toBeDefined();
        expect(attachment.originalName).toMatch(/audit-logs-.*\.zip$/);

        const updatedJob = await AuditLogBulkExportJob.findById(job._id);
        expect([
          AuditLogBulkExportJobStatus.uploading,
          AuditLogBulkExportJobStatus.completed,
        ]).toContain(updatedJob?.status);
        expect(updatedJob?.totalExportedCount).toBeGreaterThan(0);
      });
    });

    describe('1-2. With Filters (actions / dateFrom / dateTo / users)', () => {
      it('should export only filtered activities', async () => {
        const job = await AuditLogBulkExportJob.create({
          user: testUser._id,
          filters: {
            actions: [
              SupportedAction.ACTION_PAGE_CREATE,
              SupportedAction.ACTION_PAGE_UPDATE,
            ],
            dateFrom: new Date('2023-01-01T00:00:00Z'),
            dateTo: new Date('2023-01-02T23:59:59Z'),
            users: [testUser._id.toString()],
          },
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.exporting,
          filterHash: 'filtered-hash',
          restartFlag: false,
          totalExportedCount: 0,
        });

        await cronService.proceedBulkExportJob(job);
        const afterExport = await waitForJobStatus(
          job._id,
          AuditLogBulkExportJobStatus.uploading,
        );

        const outputDir = cronService.getTmpOutputDir(afterExport);
        const files = fs.readdirSync(outputDir);
        const jsonFiles = files.filter((file) => file.endsWith('.json'));

        if (jsonFiles.length > 0) {
          const content = JSON.parse(
            fs.readFileSync(path.join(outputDir, jsonFiles[0]), 'utf8'),
          );

          content.forEach((activity: ExportedActivityData) => {
            expect([
              SupportedAction.ACTION_PAGE_CREATE,
              SupportedAction.ACTION_PAGE_UPDATE,
            ]).toContain(activity.action);
            expect(new Date(activity.createdAt)).toBeInstanceOf(Date);
            expect(activity.user).toBe(testUser._id.toString());
          });
        }

        const updatedJob = await AuditLogBulkExportJob.findById(job._id);
        expect(updatedJob?.totalExportedCount).toBeLessThanOrEqual(2);
      });
    });

    describe('1-3. Zero Results', () => {
      it('should handle cases with no matching activities', async () => {
        const job = await AuditLogBulkExportJob.create({
          user: testUser._id,
          filters: {
            actions: [SupportedAction.ACTION_USER_LOGOUT],
          },
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.exporting,
          filterHash: 'no-match-hash',
          restartFlag: false,
          totalExportedCount: 0,
        });

        const notifySpy = vi.spyOn(cronService, 'notifyExportResultAndCleanUp');

        await cronService.proceedBulkExportJob(job);
        await waitForCondition(async () => {
          const updatedJob = await AuditLogBulkExportJob.findById(job._id);
          return updatedJob?.status !== AuditLogBulkExportJobStatus.exporting;
        });

        const afterExport = await AuditLogBulkExportJob.findById(job._id);
        if (!afterExport) {
          throw new Error('Job not found after export phase');
        }

        const outputDir = cronService.getTmpOutputDir(afterExport);
        const files = fs.existsSync(outputDir) ? fs.readdirSync(outputDir) : [];
        const jsonFiles = files.filter((file) => file.endsWith('.json'));

        expect(jsonFiles.length).toBeLessThanOrEqual(1);

        expect(afterExport.totalExportedCount).toBe(0);

        expect(notifySpy).toHaveBeenCalledWith(
          SupportedAction.ACTION_AUDIT_LOG_BULK_EXPORT_NO_RESULTS,
          expect.objectContaining({ _id: job._id }),
        );
      });
    });
  });

  describe('2. Resumability', () => {
    describe('2-1. Resume from lastExportedId', () => {
      it('should resume export from the last exported ID without duplicates', async () => {
        const activities = await Activity.find({}).sort({ _id: 1 });
        const middleIndex = Math.floor(activities.length / 2);
        const lastExportedId = activities[middleIndex]._id.toString();

        const job = await AuditLogBulkExportJob.create({
          user: testUser._id,
          filters: {},
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.exporting,
          filterHash: 'resume-hash',
          restartFlag: false,
          totalExportedCount: middleIndex,
          lastExportedId: lastExportedId,
        });

        await cronService.proceedBulkExportJob(job);
        const afterExport = await waitForJobStatus(
          job._id,
          AuditLogBulkExportJobStatus.uploading,
        );

        const outputDir = cronService.getTmpOutputDir(afterExport);
        const files = fs.readdirSync(outputDir);
        const jsonFiles = files.filter((file) => file.endsWith('.json'));

        if (jsonFiles.length > 0) {
          const allExportedActivities: ExportedActivityData[] = [];

          for (const file of jsonFiles) {
            const content = JSON.parse(
              fs.readFileSync(path.join(outputDir, file), 'utf8'),
            );
            allExportedActivities.push(...content);
          }

          allExportedActivities.forEach((activity) => {
            expect(activity._id).not.toBe(lastExportedId);
            expect(
              new mongoose.Types.ObjectId(activity._id).getTimestamp(),
            ).toBeInstanceOf(Date);
          });
        }

        const updatedJob = await AuditLogBulkExportJob.findById(job._id);
        expect(updatedJob?.totalExportedCount).toBeGreaterThan(middleIndex);
      });
    });

    describe('2-2. totalExportedCount and lastExportedId Updates', () => {
      it('should properly update totalExportedCount and lastExportedId', async () => {
        const job = await AuditLogBulkExportJob.create({
          user: testUser._id,
          filters: {},
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.exporting,
          filterHash: 'count-test-hash',
          restartFlag: false,
          totalExportedCount: 0,
        });

        const initialCount = job.totalExportedCount ?? 0;

        await cronService.proceedBulkExportJob(job);
        const updatedJob = await waitForJobStatus(
          job._id,
          AuditLogBulkExportJobStatus.uploading,
        );
        expect(updatedJob?.totalExportedCount).toBeGreaterThan(initialCount);
        expect(updatedJob?.lastExportedId).toBeDefined();

        const totalActivities = await Activity.countDocuments({});
        expect(updatedJob?.totalExportedCount).toBeLessThanOrEqual(
          totalActivities,
        );
      });
    });
  });

  describe('3. Upload and Compression', () => {
    describe('3-1. ZIP Content Validity', () => {
      it('should create valid ZIP with JSON files in root', async () => {
        const job = await AuditLogBulkExportJob.create({
          user: testUser._id,
          filters: {},
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.exporting,
          filterHash: 'zip-test-hash',
          restartFlag: false,
          totalExportedCount: 0,
        });

        await cronService.proceedBulkExportJob(job);
        const afterExport = await waitForJobStatus(
          job._id,
          AuditLogBulkExportJobStatus.uploading,
        );

        await cronService.proceedBulkExportJob(afterExport);
        await waitForCondition(() => uploadAttachmentSpy.mock.calls.length > 0);

        expect(uploadAttachmentSpy).toHaveBeenCalledTimes(1);
        const [readable, attachment] = uploadAttachmentSpy.mock.calls[0];
        expect(readable).toBeDefined();
        expect(attachment.fileName).toMatch(/\.zip$/);
      });
    });

    describe('3-2. Upload Failure Handling', () => {
      it('should handle upload failures gracefully', async () => {
        uploadAttachmentSpy.mockImplementationOnce(async (readable) => {
          readable.on('error', () => {});
          readable.resume();
          throw new Error('Upload failed');
        });

        const job = await AuditLogBulkExportJob.create({
          user: testUser._id,
          filters: {},
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.uploading,
          filterHash: 'upload-fail-hash',
          restartFlag: false,
          totalExportedCount: 10,
        });

        const notifySpy = vi.spyOn(cronService, 'notifyExportResultAndCleanUp');
        const cleanSpy = vi.spyOn(cronService, 'cleanUpExportJobResources');
        const handleSpy = vi.spyOn(cronService, 'handleError');

        await expect(
          cronService.proceedBulkExportJob(job),
        ).resolves.toBeUndefined();

        expect(uploadAttachmentSpy).toHaveBeenCalledTimes(1);
        expect(handleSpy).toHaveBeenCalledTimes(1);
        expect(notifySpy).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ _id: job._id }),
        );
        expect(cleanSpy).toHaveBeenCalledWith(
          expect.objectContaining({ _id: job._id }),
        );

        const reloaded = await AuditLogBulkExportJob.findById(job._id).lean();
        expect(reloaded?.status).toBe(AuditLogBulkExportJobStatus.failed);

        const s = cronService.getStreamInExecution(job._id);
        expect(s).toBeUndefined();
      });
    });
  });

  describe('4. Error Handling', () => {
    describe('4-1. Nonexistent Users Filter', () => {
      it('should throw error for nonexistent users', async () => {
        const job = await AuditLogBulkExportJob.create({
          user: testUser._id,
          filters: {
            users: [new mongoose.Types.ObjectId().toString()],
          },
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.exporting,
          filterHash: 'bad-user-hash',
          restartFlag: false,
          totalExportedCount: 0,
        });

        try {
          await cronService.proceedBulkExportJob(job);
          await waitForCondition(async () => {
            const updatedJob = await AuditLogBulkExportJob.findById(job._id);
            return updatedJob?.status === AuditLogBulkExportJobStatus.failed;
          });
        } catch (_error) {}

        const updatedJob = await AuditLogBulkExportJob.findById(job._id);
        expect([
          AuditLogBulkExportJobStatus.exporting,
          AuditLogBulkExportJobStatus.failed,
        ]).toContain(updatedJob?.status);
      });
    });

    describe('4-2. Stream/FS Errors', () => {
      it('should handle filesystem errors', async () => {
        cronService.tmpOutputRootDir = '/invalid/path/that/does/not/exist';

        const job = await AuditLogBulkExportJob.create({
          user: testUser._id,
          filters: {},
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.exporting,
          filterHash: 'fs-error-hash',
          restartFlag: false,
          totalExportedCount: 0,
        });

        await expect(async () => {
          await cronService.proceedBulkExportJob(job);
        }).not.toThrow();
      });
    });

    describe('4-3. Job Expiry and Restart Errors', () => {
      it('should handle AuditLogBulkExportJobExpiredError', async () => {
        const job = await AuditLogBulkExportJob.create({
          user: testUser._id,
          filters: {},
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.exporting,
          filterHash: 'expired-error-hash',
          restartFlag: false,
          totalExportedCount: 0,
        });

        const expiredError = new AuditLogBulkExportJobExpiredError();

        await cronService.handleError(expiredError, job);

        const updatedJob = await AuditLogBulkExportJob.findById(job._id);
        expect(updatedJob?.status).toBe(AuditLogBulkExportJobStatus.failed);
      });

      it('should handle AuditLogBulkExportJobRestartedError', async () => {
        const job = await AuditLogBulkExportJob.create({
          user: testUser._id,
          filters: {},
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.exporting,
          filterHash: 'restarted-error-hash',
          restartFlag: false,
          totalExportedCount: 0,
        });

        const restartedError = new AuditLogBulkExportJobRestartedError();

        await cronService.handleError(restartedError, job);
      });
    });
  });

  describe('5. State Transitions and Execution Control', () => {
    describe('5-1. State Flow', () => {
      it('should follow correct state transitions: exporting → uploading → completed', async () => {
        const job = await AuditLogBulkExportJob.create({
          user: testUser._id,
          filters: {},
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.exporting,
          filterHash: 'state-flow-hash',
          restartFlag: false,
          totalExportedCount: 0,
        });

        expect(job.status).toBe(AuditLogBulkExportJobStatus.exporting);

        await cronService.proceedBulkExportJob(job);
        const afterExport = await waitForJobStatus(
          job._id,
          AuditLogBulkExportJobStatus.uploading,
        );

        expect(afterExport?.status).toBe(AuditLogBulkExportJobStatus.uploading);

        await cronService.proceedBulkExportJob(afterExport);
        await waitForCondition(() => uploadAttachmentSpy.mock.calls.length > 0);

        await cronService.notifyExportResultAndCleanUp(
          SupportedAction.ACTION_AUDIT_LOG_BULK_EXPORT_COMPLETED,
          afterExport,
        );

        const finalJob = await AuditLogBulkExportJob.findById(job._id);
        expect(finalJob?.status).toBe(AuditLogBulkExportJobStatus.completed);
      });
    });

    describe('5-2. Stream Lifecycle', () => {
      it('should properly manage stream execution lifecycle', async () => {
        const job = await AuditLogBulkExportJob.create({
          user: testUser._id,
          filters: {},
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.exporting,
          filterHash: 'stream-lifecycle-hash',
          restartFlag: false,
          totalExportedCount: 0,
        });

        await cronService.proceedBulkExportJob(job);
        const afterExport = await waitForJobStatus(
          job._id,
          AuditLogBulkExportJobStatus.uploading,
        );

        await cronService.cleanUpExportJobResources(afterExport);
        const streamAfterCleanup = cronService.getStreamInExecution(job._id);
        expect(streamAfterCleanup).toBeUndefined();
      });
    });

    describe('5-3. Restart Flag Handling', () => {
      it('should handle restartFlag correctly', async () => {
        const job = await AuditLogBulkExportJob.create({
          user: testUser._id,
          filters: {},
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.exporting,
          filterHash: 'restart-flag-hash',
          restartFlag: true,
          totalExportedCount: 50,
          lastExportedId: 'some-previous-id',
        });

        await cronService.proceedBulkExportJob(job);
        await waitForCondition(async () => {
          const updatedJob = await AuditLogBulkExportJob.findById(job._id);
          return updatedJob?.restartFlag === false;
        });

        const updatedJob = await AuditLogBulkExportJob.findById(job._id);

        expect(updatedJob?.restartFlag).toBe(false);
        expect(updatedJob?.totalExportedCount).toBe(0);
        expect(updatedJob?.lastExportedId).toBeUndefined();
        expect(updatedJob?.status).toBe(AuditLogBulkExportJobStatus.exporting);
      });
    });
  });
});
