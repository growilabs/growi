import type { IUser } from '@growi/core';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import { AttachmentService } from '~/server/service/attachment';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import {
  AuditLogBulkExportFormat,
  AuditLogBulkExportJobStatus,
} from '../../interfaces/audit-log-bulk-export';
import instantiateAuditLogBulkExportJobCleanUpCronService, {
  auditLogBulkExportJobCleanUpCronService,
} from './audit-log-bulk-export-job-clean-up-cron';

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

vi.mock('./audit-log-bulk-export-job-cron', () => {
  return {
    auditLogBulkExportJobCronService: {
      cleanUpExportJobResources: vi.fn(() => Promise.resolve()),
      notifyExportResultAndCleanUp: vi.fn(() => Promise.resolve()),
    },
  };
});

describe('AuditLogBulkExportJobCleanUpCronService', () => {
  // Only the file store is faked; removeAttachment itself runs for real so the
  // Prisma-side attachment deletion is exercised through the cleanup flow.
  const deleteFileMock = vi.fn(() => Promise.resolve());
  const crowi = mock<Crowi>({
    fileUploadService: { deleteFile: deleteFileMock },
  });
  crowi.attachmentService = new AttachmentService(crowi);
  let userId: string;

  beforeAll(async () => {
    await configManager.loadConfigs();
    const user = await User.create({
      name: 'Example for AuditLogBulkExportJobCleanUpCronService Test',
      username: 'audit log bulk export job cleanup cron test user',
      email: 'auditLogBulkExportCleanUpCronTestUser@example.com',
    });
    userId = user._id.toString();
    instantiateAuditLogBulkExportJobCleanUpCronService(crowi);
  });

  beforeEach(async () => {
    await prisma.auditlogbulkexportjobs.deleteMany();
    await prisma.attachments.deleteMany();
    deleteFileMock.mockClear();
  });

  describe('deleteExpiredExportJobs', () => {
    const jobId1 = new mongoose.Types.ObjectId();
    const jobId2 = new mongoose.Types.ObjectId();
    const jobId3 = new mongoose.Types.ObjectId();
    const jobId4 = new mongoose.Types.ObjectId();
    beforeEach(async () => {
      await configManager.updateConfig(
        'app:bulkExportJobExpirationSeconds',
        86400,
      );

      await prisma.auditlogbulkexportjobs.createMany({
        data: [
          {
            id: jobId1.toString(),
            userId,
            filters: {},
            filterHash: 'hash1',
            format: AuditLogBulkExportFormat.json,
            status: AuditLogBulkExportJobStatus.exporting,
            restartFlag: false,
            createdAt: new Date(Date.now()),
          },
          {
            id: jobId2.toString(),
            userId,
            filters: {},
            filterHash: 'hash2',
            format: AuditLogBulkExportFormat.json,
            status: AuditLogBulkExportJobStatus.exporting,
            restartFlag: false,
            createdAt: new Date(Date.now() - 86400 * 1000 - 1),
          },
          {
            id: jobId3.toString(),
            userId,
            filters: {},
            filterHash: 'hash3',
            format: AuditLogBulkExportFormat.json,
            status: AuditLogBulkExportJobStatus.uploading,
            restartFlag: false,
            createdAt: new Date(Date.now() - 86400 * 1000 - 2),
          },
          {
            id: jobId4.toString(),
            userId,
            filters: {},
            filterHash: 'hash4',
            format: AuditLogBulkExportFormat.json,
            status: AuditLogBulkExportJobStatus.failed,
            restartFlag: false,
          },
        ],
      });
    });

    test('should delete expired jobs', async () => {
      expect(await prisma.auditlogbulkexportjobs.findMany()).toHaveLength(4);

      await auditLogBulkExportJobCleanUpCronService?.deleteExpiredExportJobs();
      const jobs = await prisma.auditlogbulkexportjobs.findMany();

      expect(jobs).toHaveLength(2);
      expect(jobs.map((job) => job.id).sort()).toStrictEqual(
        [jobId1, jobId4].map(String).sort(),
      );
    });
  });

  describe('deleteDownloadExpiredExportJobs', () => {
    const jobId1 = new mongoose.Types.ObjectId();
    const jobId2 = new mongoose.Types.ObjectId();
    const jobId3 = new mongoose.Types.ObjectId();
    const jobId4 = new mongoose.Types.ObjectId();
    beforeEach(async () => {
      await configManager.updateConfig(
        'app:bulkExportDownloadExpirationSeconds',
        86400,
      );

      await prisma.auditlogbulkexportjobs.createMany({
        data: [
          {
            id: jobId1.toString(),
            userId,
            filters: {},
            filterHash: 'hash1',
            format: AuditLogBulkExportFormat.json,
            status: AuditLogBulkExportJobStatus.completed,
            restartFlag: false,
            completedAt: new Date(Date.now()),
          },
          {
            id: jobId2.toString(),
            userId,
            filters: {},
            filterHash: 'hash2',
            format: AuditLogBulkExportFormat.json,
            status: AuditLogBulkExportJobStatus.completed,
            restartFlag: false,
            completedAt: new Date(Date.now() - 86400 * 1000 - 1),
          },
          {
            id: jobId3.toString(),
            userId,
            filters: {},
            filterHash: 'hash3',
            format: AuditLogBulkExportFormat.json,
            status: AuditLogBulkExportJobStatus.exporting,
            restartFlag: false,
          },
          {
            id: jobId4.toString(),
            userId,
            filters: {},
            filterHash: 'hash4',
            format: AuditLogBulkExportFormat.json,
            status: AuditLogBulkExportJobStatus.failed,
            restartFlag: false,
          },
        ],
      });
    });

    test('should delete download expired jobs', async () => {
      expect(await prisma.auditlogbulkexportjobs.findMany()).toHaveLength(4);

      await auditLogBulkExportJobCleanUpCronService?.deleteDownloadExpiredExportJobs();
      const jobs = await prisma.auditlogbulkexportjobs.findMany();

      expect(jobs).toHaveLength(3);
      expect(jobs.map((job) => job.id).sort()).toStrictEqual(
        [jobId1, jobId3, jobId4].map(String).sort(),
      );
    });

    describe('with a stored attachment', () => {
      const createAttachment = () =>
        prisma.attachments.create({
          data: {
            fileFormat: 'application/zip',
            fileName: 'export.zip',
            originalName: 'export.zip',
            attachmentType: 'BULK_EXPORT',
            fileSize: 1,
          },
        });
      const createExpiredJob = (attachmentId?: string) =>
        prisma.auditlogbulkexportjobs.create({
          data: {
            userId,
            filters: {},
            filterHash: 'hash-attachment',
            format: AuditLogBulkExportFormat.json,
            status: AuditLogBulkExportJobStatus.completed,
            completedAt: new Date(Date.now() - 86400 * 1000 - 1),
            attachmentId,
          },
        });

      beforeEach(async () => {
        // the enclosing describe seeds jobs this scenario must not see
        await prisma.auditlogbulkexportjobs.deleteMany();
      });

      test('should remove the attachment, then delete the job that referenced it', async () => {
        const attachment = await createAttachment();
        await createExpiredJob(attachment.id);

        await auditLogBulkExportJobCleanUpCronService?.deleteDownloadExpiredExportJobs();

        expect(deleteFileMock).toHaveBeenCalledTimes(1);
        expect(
          await prisma.attachments.findUnique({ where: { id: attachment.id } }),
        ).toBeNull();
        expect(await prisma.auditlogbulkexportjobs.findMany()).toHaveLength(0);
      });

      test('should delete a job that has no attachment without touching the file store', async () => {
        await createExpiredJob();

        await auditLogBulkExportJobCleanUpCronService?.deleteDownloadExpiredExportJobs();

        expect(deleteFileMock).not.toHaveBeenCalled();
        expect(await prisma.auditlogbulkexportjobs.findMany()).toHaveLength(0);
      });

      test('should keep the job for retry when the file store fails, leaving the attachment row intact', async () => {
        const attachment = await createAttachment();
        const job = await createExpiredJob(attachment.id);
        deleteFileMock.mockRejectedValueOnce(new Error('file store down'));

        await auditLogBulkExportJobCleanUpCronService?.deleteDownloadExpiredExportJobs();

        const remainingJob = await prisma.auditlogbulkexportjobs.findUnique({
          where: { id: job.id },
        });
        expect(remainingJob?.attachmentId).toBe(attachment.id);
        expect(
          await prisma.attachments.findUnique({ where: { id: attachment.id } }),
        ).not.toBeNull();
      });

      test('should null out attachmentId on a surviving job when its attachment is deleted (SetNull)', async () => {
        const attachment = await createAttachment();
        const job = await createExpiredJob(attachment.id);

        await prisma.attachments.delete({ where: { id: attachment.id } });

        const survivingJob = await prisma.auditlogbulkexportjobs.findUnique({
          where: { id: job.id },
        });
        expect(survivingJob).not.toBeNull();
        expect(survivingJob?.attachmentId).toBeNull();
      });
    });
  });

  describe('deleteFailedExportJobs', () => {
    const jobId1 = new mongoose.Types.ObjectId();
    const jobId2 = new mongoose.Types.ObjectId();
    const jobId3 = new mongoose.Types.ObjectId();
    beforeEach(async () => {
      await prisma.auditlogbulkexportjobs.createMany({
        data: [
          {
            id: jobId1.toString(),
            userId,
            filters: {},
            filterHash: 'hash1',
            format: AuditLogBulkExportFormat.json,
            status: AuditLogBulkExportJobStatus.failed,
            restartFlag: false,
          },
          {
            id: jobId2.toString(),
            userId,
            filters: {},
            filterHash: 'hash2',
            format: AuditLogBulkExportFormat.json,
            status: AuditLogBulkExportJobStatus.exporting,
            restartFlag: false,
          },
          {
            id: jobId3.toString(),
            userId,
            filters: {},
            filterHash: 'hash3',
            format: AuditLogBulkExportFormat.json,
            status: AuditLogBulkExportJobStatus.failed,
            restartFlag: false,
          },
        ],
      });
    });

    test('should delete failed export jobs', async () => {
      expect(await prisma.auditlogbulkexportjobs.findMany()).toHaveLength(3);

      await auditLogBulkExportJobCleanUpCronService?.deleteFailedExportJobs();
      const jobs = await prisma.auditlogbulkexportjobs.findMany();

      expect(jobs).toHaveLength(1);
      expect(jobs.map((job) => job.id)).toStrictEqual([jobId2.toString()]);
    });
  });
});
