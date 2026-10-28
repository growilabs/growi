import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import { AttachmentService } from '~/server/service/attachment';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import {
  PageBulkExportFormat,
  PageBulkExportJobStatus,
} from '../../interfaces/page-bulk-export';
import instanciatePageBulkExportJobCleanUpCronService, {
  pageBulkExportJobCleanUpCronService,
} from './page-bulk-export-job-clean-up-cron';

vi.mock('./page-bulk-export-job-cron', () => {
  return {
    pageBulkExportJobCronService: {
      cleanUpExportJobResources: vi.fn(() => Promise.resolve()),
      notifyExportResultAndCleanUp: vi.fn(() => Promise.resolve()),
    },
  };
});

const newObjectIdString = () => new mongoose.Types.ObjectId().toString();

describe('PageBulkExportJobCleanUpCronService', () => {
  // Only the file store is faked; removeAttachment itself runs for real so the
  // Prisma-side attachment deletion is exercised through the cleanup flow.
  const deleteFileMock = vi.fn(() => Promise.resolve());
  const crowi = mock<Crowi>({
    fileUploadService: { deleteFile: deleteFileMock },
  });
  const attachmentService = new AttachmentService(crowi);
  crowi.attachmentService = attachmentService;
  const removeAttachmentMock = vi.spyOn(attachmentService, 'removeAttachment');
  const userId = newObjectIdString();

  beforeAll(async () => {
    await configManager.loadConfigs();
    instanciatePageBulkExportJobCleanUpCronService(crowi);
  });

  beforeEach(async () => {
    await prisma.pagebulkexportjobs.deleteMany();
    await prisma.attachments.deleteMany();
    removeAttachmentMock.mockClear();
    deleteFileMock.mockClear();
  });

  describe('deleteExpiredExportJobs', () => {
    // arrange
    const jobId1 = newObjectIdString();
    const jobId2 = newObjectIdString();
    const jobId3 = newObjectIdString();
    const jobId4 = newObjectIdString();
    beforeEach(async () => {
      await configManager.updateConfig(
        'app:bulkExportJobExpirationSeconds',
        86400,
      ); // 1 day

      await prisma.pagebulkexportjobs.createMany({
        data: [
          {
            id: jobId1,
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.initializing,
            createdAt: new Date(Date.now()),
          },
          {
            id: jobId2,
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.exporting,
            createdAt: new Date(Date.now() - 86400 * 1000 - 1),
          },
          {
            id: jobId3,
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.uploading,
            createdAt: new Date(Date.now() - 86400 * 1000 - 2),
          },
          {
            id: jobId4,
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.failed,
          },
        ],
      });
    });

    test('should delete expired jobs', async () => {
      expect(await prisma.pagebulkexportjobs.findMany()).toHaveLength(4);

      // act
      await pageBulkExportJobCleanUpCronService?.deleteExpiredExportJobs();
      const jobs = await prisma.pagebulkexportjobs.findMany();

      // assert
      expect(jobs).toHaveLength(2);
      expect(jobs.map((job) => job.id).sort()).toStrictEqual(
        [jobId1, jobId4].sort(),
      );
    });
  });

  describe('deleteDownloadExpiredExportJobs', () => {
    // arrange
    const jobId1 = newObjectIdString();
    const jobId2 = newObjectIdString();
    const jobId3 = newObjectIdString();
    const jobId4 = newObjectIdString();
    beforeEach(async () => {
      await configManager.updateConfig(
        'app:bulkExportDownloadExpirationSeconds',
        86400,
      ); // 1 day

      await prisma.pagebulkexportjobs.createMany({
        data: [
          {
            id: jobId1,
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.completed,
            completedAt: new Date(Date.now()),
          },
          {
            id: jobId2,
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.completed,
            completedAt: new Date(Date.now() - 86400 * 1000 - 1),
          },
          {
            id: jobId3,
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.initializing,
          },
          {
            id: jobId4,
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.failed,
          },
        ],
      });
    });

    test('should delete download expired jobs', async () => {
      expect(await prisma.pagebulkexportjobs.findMany()).toHaveLength(4);

      // act
      await pageBulkExportJobCleanUpCronService?.deleteDownloadExpiredExportJobs();
      const jobs = await prisma.pagebulkexportjobs.findMany();

      // assert
      expect(jobs).toHaveLength(3);
      expect(jobs.map((job) => job.id).sort()).toStrictEqual(
        [jobId1, jobId3, jobId4].sort(),
      );
    });

    describe('with a stored attachment', () => {
      beforeEach(async () => {
        // the enclosing describe seeds jobs this scenario must not see
        await prisma.pagebulkexportjobs.deleteMany();
      });

      test('should remove the attachment, then delete the job that referenced it', async () => {
        // arrange
        const attachment = await prisma.attachments.create({
          data: {
            fileFormat: 'application/zip',
            fileName: 'export.zip',
            originalName: 'export.zip',
            attachmentType: 'BULK_EXPORT',
            fileSize: 1,
          },
        });
        await prisma.pagebulkexportjobs.create({
          data: {
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.completed,
            completedAt: new Date(Date.now() - 86400 * 1000 - 1),
            attachmentId: attachment.id,
          },
        });

        // act
        await pageBulkExportJobCleanUpCronService?.deleteDownloadExpiredExportJobs();

        // assert
        expect(deleteFileMock).toHaveBeenCalledTimes(1);
        expect(
          await prisma.attachments.findUnique({ where: { id: attachment.id } }),
        ).toBeNull();
        expect(await prisma.pagebulkexportjobs.findMany()).toHaveLength(0);
      });

      test('should keep the job for retry when the file store fails, leaving the attachment row intact', async () => {
        // arrange
        const attachment = await prisma.attachments.create({
          data: {
            fileFormat: 'application/zip',
            fileName: 'export.zip',
            originalName: 'export.zip',
            attachmentType: 'BULK_EXPORT',
            fileSize: 1,
          },
        });
        const job = await prisma.pagebulkexportjobs.create({
          data: {
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.completed,
            completedAt: new Date(Date.now() - 86400 * 1000 - 1),
            attachmentId: attachment.id,
          },
        });
        deleteFileMock.mockRejectedValueOnce(new Error('file store down'));

        // act
        await pageBulkExportJobCleanUpCronService?.deleteDownloadExpiredExportJobs();

        // assert: both rows survive so the next cron execution can retry
        const remainingJob = await prisma.pagebulkexportjobs.findUnique({
          where: { id: job.id },
        });
        expect(remainingJob?.attachmentId).toBe(attachment.id);
        expect(
          await prisma.attachments.findUnique({ where: { id: attachment.id } }),
        ).not.toBeNull();
      });
    });
  });

  // Regression coverage for the race condition that left zombie job records
  // when multiple expired jobs shared a single attachment (the duplicate-reuse
  // path re-binds an existing attachment to a fresh job). Without the dedup,
  // the concurrent cleanup loop calls removeAttachment per-sibling and the
  // loser of the race throws "Attachment not found", which silently drops its
  // job record out of the deleteMany() set.
  describe('deleteDownloadExpiredExportJobs (shared attachment)', () => {
    const sharedAttachmentId = newObjectIdString();
    const otherAttachmentId = newObjectIdString();

    beforeEach(async () => {
      await configManager.updateConfig(
        'app:bulkExportDownloadExpirationSeconds',
        86400,
      ); // 1 day
    });

    test('should call removeAttachment exactly once when multiple expired jobs share the same attachment', async () => {
      // arrange: two expired jobs pointing at the same attachment (the
      // duplicate-reuse path produces this shape)
      const expiredAt = new Date(Date.now() - 86400 * 1000 - 1);
      await prisma.pagebulkexportjobs.createMany({
        data: [
          {
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.completed,
            completedAt: expiredAt,
            attachmentId: sharedAttachmentId,
          },
          {
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.completed,
            completedAt: expiredAt,
            attachmentId: sharedAttachmentId,
          },
        ],
      });

      // act
      await pageBulkExportJobCleanUpCronService?.deleteDownloadExpiredExportJobs();

      // assert: only one removeAttachment call for the shared attachment, and
      // both job records are gone (no zombie left behind)
      expect(removeAttachmentMock).toHaveBeenCalledTimes(1);
      expect(removeAttachmentMock).toHaveBeenCalledWith(sharedAttachmentId);
      expect(await prisma.pagebulkexportjobs.findMany()).toHaveLength(0);
    });

    test('should still remove distinct attachments once each when expired jobs reference different attachments', async () => {
      // arrange: ensure the dedup does not over-merge across distinct attachments
      const expiredAt = new Date(Date.now() - 86400 * 1000 - 1);
      await prisma.pagebulkexportjobs.createMany({
        data: [
          {
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.completed,
            completedAt: expiredAt,
            attachmentId: sharedAttachmentId,
          },
          {
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.completed,
            completedAt: expiredAt,
            attachmentId: otherAttachmentId,
          },
        ],
      });

      // act
      await pageBulkExportJobCleanUpCronService?.deleteDownloadExpiredExportJobs();

      // assert
      expect(removeAttachmentMock).toHaveBeenCalledTimes(2);
      expect(removeAttachmentMock).toHaveBeenCalledWith(sharedAttachmentId);
      expect(removeAttachmentMock).toHaveBeenCalledWith(otherAttachmentId);
      expect(await prisma.pagebulkexportjobs.findMany()).toHaveLength(0);
    });

    test('should not call removeAttachment when an unexpired sibling job still references the attachment', async () => {
      // arrange: one expired + one unexpired sharing the same attachment.
      // The unexpired sibling protects the attachment from deletion.
      await prisma.pagebulkexportjobs.createMany({
        data: [
          {
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.completed,
            completedAt: new Date(Date.now() - 86400 * 1000 - 1),
            attachmentId: sharedAttachmentId,
          },
          {
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.completed,
            completedAt: new Date(Date.now()),
            attachmentId: sharedAttachmentId,
          },
        ],
      });

      // act
      await pageBulkExportJobCleanUpCronService?.deleteDownloadExpiredExportJobs();

      // assert: attachment retained, only the expired job is gone
      expect(removeAttachmentMock).not.toHaveBeenCalled();
      const remaining = await prisma.pagebulkexportjobs.findMany();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].attachmentId).toBe(sharedAttachmentId);
    });

    test('should delete an expired job whose removeAttachment resolves as a no-op (zombie with dangling attachment ref)', async () => {
      // arrange: simulate the real removeAttachment idempotent contract — when
      // the attachment metadata doc is already gone, the call resolves without
      // throwing. The job record must still be deleteMany()-d.
      const zombieAttachmentId = newObjectIdString();
      await prisma.pagebulkexportjobs.create({
        data: {
          userId,
          pageId: newObjectIdString(),
          format: PageBulkExportFormat.md,
          status: PageBulkExportJobStatus.completed,
          completedAt: new Date(Date.now() - 86400 * 1000 - 1),
          attachmentId: zombieAttachmentId,
        },
      });

      // act
      await pageBulkExportJobCleanUpCronService?.deleteDownloadExpiredExportJobs();

      // assert
      expect(removeAttachmentMock).toHaveBeenCalledTimes(1);
      expect(removeAttachmentMock).toHaveBeenCalledWith(zombieAttachmentId);
      expect(await prisma.pagebulkexportjobs.findMany()).toHaveLength(0);
    });
  });

  describe('deleteFailedExportJobs', () => {
    // arrange
    const jobId1 = newObjectIdString();
    const jobId2 = newObjectIdString();
    const jobId3 = newObjectIdString();
    beforeEach(async () => {
      await prisma.pagebulkexportjobs.createMany({
        data: [
          {
            id: jobId1,
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.failed,
          },
          {
            id: jobId2,
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.initializing,
          },
          {
            id: jobId3,
            userId,
            pageId: newObjectIdString(),
            format: PageBulkExportFormat.md,
            status: PageBulkExportJobStatus.failed,
          },
        ],
      });
    });

    test('should delete failed export jobs', async () => {
      expect(await prisma.pagebulkexportjobs.findMany()).toHaveLength(3);

      // act
      await pageBulkExportJobCleanUpCronService?.deleteFailedExportJobs();
      const jobs = await prisma.pagebulkexportjobs.findMany();

      // assert
      expect(jobs).toHaveLength(1);
      expect(jobs.map((job) => job.id)).toStrictEqual([jobId2]);
    });
  });
});
