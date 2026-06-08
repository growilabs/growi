import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';

import {
  PageBulkExportFormat,
  PageBulkExportJobStatus,
} from '../../interfaces/page-bulk-export';
import PageBulkExportJob from '../models/page-bulk-export-job';
import instanciatePageBulkExportJobCleanUpCronService, {
  pageBulkExportJobCleanUpCronService,
} from './page-bulk-export-job-clean-up-cron';

// TODO: use actual user model after ~/server/models/user.js becomes importable in vitest
// ref: https://github.com/vitest-dev/vitest/issues/846
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
const User = mongoose.model('User', userSchema);

vi.mock('./page-bulk-export-job-cron', () => {
  return {
    pageBulkExportJobCronService: {
      cleanUpExportJobResources: vi.fn(() => Promise.resolve()),
      notifyExportResultAndCleanUp: vi.fn(() => Promise.resolve()),
    },
  };
});

describe('PageBulkExportJobCleanUpCronService', () => {
  const removeAttachmentMock = vi.fn(() => Promise.resolve());
  const crowi = mock<Crowi>({
    attachmentService: {
      removeAttachment: removeAttachmentMock,
    },
  });
  let user: mongoose.HydratedDocument<
    mongoose.InferSchemaType<typeof userSchema>
  >;

  beforeAll(async () => {
    await configManager.loadConfigs();
    user = await User.create({
      name: 'Example for PageBulkExportJobCleanUpCronService Test',
      username: 'page bulk export job cleanup cron test user',
      email: 'bulkExportCleanUpCronTestUser@example.com',
    });
    instanciatePageBulkExportJobCleanUpCronService(crowi);
  });

  beforeEach(async () => {
    await PageBulkExportJob.deleteMany();
    removeAttachmentMock.mockClear();
  });

  describe('deleteExpiredExportJobs', () => {
    // arrange
    const jobId1 = new mongoose.Types.ObjectId();
    const jobId2 = new mongoose.Types.ObjectId();
    const jobId3 = new mongoose.Types.ObjectId();
    const jobId4 = new mongoose.Types.ObjectId();
    beforeEach(async () => {
      await configManager.updateConfig(
        'app:bulkExportJobExpirationSeconds',
        86400,
      ); // 1 day

      await PageBulkExportJob.insertMany([
        {
          _id: jobId1,
          user,
          page: new mongoose.Types.ObjectId(),
          format: PageBulkExportFormat.md,
          status: PageBulkExportJobStatus.initializing,
          createdAt: new Date(Date.now()),
        },
        {
          _id: jobId2,
          user,
          page: new mongoose.Types.ObjectId(),
          format: PageBulkExportFormat.md,
          status: PageBulkExportJobStatus.exporting,
          createdAt: new Date(Date.now() - 86400 * 1000 - 1),
        },
        {
          _id: jobId3,
          user,
          page: new mongoose.Types.ObjectId(),
          format: PageBulkExportFormat.md,
          status: PageBulkExportJobStatus.uploading,
          createdAt: new Date(Date.now() - 86400 * 1000 - 2),
        },
        {
          _id: jobId4,
          user,
          page: new mongoose.Types.ObjectId(),
          format: PageBulkExportFormat.md,
          status: PageBulkExportJobStatus.failed,
        },
      ]);
    });

    test('should delete expired jobs', async () => {
      expect(await PageBulkExportJob.find()).toHaveLength(4);

      // act
      await pageBulkExportJobCleanUpCronService?.deleteExpiredExportJobs();
      const jobs = await PageBulkExportJob.find();

      // assert
      expect(jobs).toHaveLength(2);
      expect(jobs.map((job) => job._id).sort()).toStrictEqual(
        [jobId1, jobId4].sort(),
      );
    });
  });

  describe('deleteDownloadExpiredExportJobs', () => {
    // arrange
    const jobId1 = new mongoose.Types.ObjectId();
    const jobId2 = new mongoose.Types.ObjectId();
    const jobId3 = new mongoose.Types.ObjectId();
    const jobId4 = new mongoose.Types.ObjectId();
    beforeEach(async () => {
      await configManager.updateConfig(
        'app:bulkExportDownloadExpirationSeconds',
        86400,
      ); // 1 day

      await PageBulkExportJob.insertMany([
        {
          _id: jobId1,
          user,
          page: new mongoose.Types.ObjectId(),
          format: PageBulkExportFormat.md,
          status: PageBulkExportJobStatus.completed,
          completedAt: new Date(Date.now()),
        },
        {
          _id: jobId2,
          user,
          page: new mongoose.Types.ObjectId(),
          format: PageBulkExportFormat.md,
          status: PageBulkExportJobStatus.completed,
          completedAt: new Date(Date.now() - 86400 * 1000 - 1),
        },
        {
          _id: jobId3,
          user,
          page: new mongoose.Types.ObjectId(),
          format: PageBulkExportFormat.md,
          status: PageBulkExportJobStatus.initializing,
        },
        {
          _id: jobId4,
          user,
          page: new mongoose.Types.ObjectId(),
          format: PageBulkExportFormat.md,
          status: PageBulkExportJobStatus.failed,
        },
      ]);
    });

    test('should delete download expired jobs', async () => {
      expect(await PageBulkExportJob.find()).toHaveLength(4);

      // act
      await pageBulkExportJobCleanUpCronService?.deleteDownloadExpiredExportJobs();
      const jobs = await PageBulkExportJob.find();

      // assert
      expect(jobs).toHaveLength(3);
      expect(jobs.map((job) => job._id).sort()).toStrictEqual(
        [jobId1, jobId3, jobId4].sort(),
      );
    });
  });

  // Regression coverage for the race condition that left zombie job records
  // when multiple expired jobs shared a single attachment (the duplicate-reuse
  // path re-binds an existing attachment to a fresh job). Without the dedup,
  // the concurrent cleanup loop calls removeAttachment per-sibling and the
  // loser of the race throws "Attachment not found", which silently drops its
  // job record out of the deleteMany() set.
  describe('deleteDownloadExpiredExportJobs (shared attachment)', () => {
    const sharedAttachmentId = new mongoose.Types.ObjectId();
    const otherAttachmentId = new mongoose.Types.ObjectId();

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
      await PageBulkExportJob.insertMany([
        {
          user,
          page: new mongoose.Types.ObjectId(),
          format: PageBulkExportFormat.md,
          status: PageBulkExportJobStatus.completed,
          completedAt: expiredAt,
          attachment: sharedAttachmentId,
        },
        {
          user,
          page: new mongoose.Types.ObjectId(),
          format: PageBulkExportFormat.md,
          status: PageBulkExportJobStatus.completed,
          completedAt: expiredAt,
          attachment: sharedAttachmentId,
        },
      ]);

      // act
      await pageBulkExportJobCleanUpCronService?.deleteDownloadExpiredExportJobs();

      // assert: only one removeAttachment call for the shared attachment, and
      // both job records are gone (no zombie left behind)
      expect(removeAttachmentMock).toHaveBeenCalledTimes(1);
      expect(removeAttachmentMock).toHaveBeenCalledWith(sharedAttachmentId);
      expect(await PageBulkExportJob.find()).toHaveLength(0);
    });

    test('should still remove distinct attachments once each when expired jobs reference different attachments', async () => {
      // arrange: ensure the dedup does not over-merge across distinct attachments
      const expiredAt = new Date(Date.now() - 86400 * 1000 - 1);
      await PageBulkExportJob.insertMany([
        {
          user,
          page: new mongoose.Types.ObjectId(),
          format: PageBulkExportFormat.md,
          status: PageBulkExportJobStatus.completed,
          completedAt: expiredAt,
          attachment: sharedAttachmentId,
        },
        {
          user,
          page: new mongoose.Types.ObjectId(),
          format: PageBulkExportFormat.md,
          status: PageBulkExportJobStatus.completed,
          completedAt: expiredAt,
          attachment: otherAttachmentId,
        },
      ]);

      // act
      await pageBulkExportJobCleanUpCronService?.deleteDownloadExpiredExportJobs();

      // assert
      expect(removeAttachmentMock).toHaveBeenCalledTimes(2);
      expect(removeAttachmentMock).toHaveBeenCalledWith(sharedAttachmentId);
      expect(removeAttachmentMock).toHaveBeenCalledWith(otherAttachmentId);
      expect(await PageBulkExportJob.find()).toHaveLength(0);
    });

    test('should not call removeAttachment when an unexpired sibling job still references the attachment', async () => {
      // arrange: one expired + one unexpired sharing the same attachment.
      // The unexpired sibling protects the attachment from deletion.
      await PageBulkExportJob.insertMany([
        {
          user,
          page: new mongoose.Types.ObjectId(),
          format: PageBulkExportFormat.md,
          status: PageBulkExportJobStatus.completed,
          completedAt: new Date(Date.now() - 86400 * 1000 - 1),
          attachment: sharedAttachmentId,
        },
        {
          user,
          page: new mongoose.Types.ObjectId(),
          format: PageBulkExportFormat.md,
          status: PageBulkExportJobStatus.completed,
          completedAt: new Date(Date.now()),
          attachment: sharedAttachmentId,
        },
      ]);

      // act
      await pageBulkExportJobCleanUpCronService?.deleteDownloadExpiredExportJobs();

      // assert: attachment retained, only the expired job is gone
      expect(removeAttachmentMock).not.toHaveBeenCalled();
      const remaining = await PageBulkExportJob.find();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].attachment?.toString()).toBe(
        sharedAttachmentId.toString(),
      );
    });

    test('should delete an expired job whose removeAttachment resolves as a no-op (zombie with dangling attachment ref)', async () => {
      // arrange: simulate the real removeAttachment idempotent contract — when
      // the attachment metadata doc is already gone, the call resolves without
      // throwing. The job record must still be deleteMany()-d.
      const zombieAttachmentId = new mongoose.Types.ObjectId();
      await PageBulkExportJob.create({
        user,
        page: new mongoose.Types.ObjectId(),
        format: PageBulkExportFormat.md,
        status: PageBulkExportJobStatus.completed,
        completedAt: new Date(Date.now() - 86400 * 1000 - 1),
        attachment: zombieAttachmentId,
      });

      // act
      await pageBulkExportJobCleanUpCronService?.deleteDownloadExpiredExportJobs();

      // assert
      expect(removeAttachmentMock).toHaveBeenCalledTimes(1);
      expect(removeAttachmentMock).toHaveBeenCalledWith(zombieAttachmentId);
      expect(await PageBulkExportJob.find()).toHaveLength(0);
    });
  });

  describe('deleteFailedExportJobs', () => {
    // arrange
    const jobId1 = new mongoose.Types.ObjectId();
    const jobId2 = new mongoose.Types.ObjectId();
    const jobId3 = new mongoose.Types.ObjectId();
    beforeEach(async () => {
      await PageBulkExportJob.insertMany([
        {
          _id: jobId1,
          user,
          page: new mongoose.Types.ObjectId(),
          format: PageBulkExportFormat.md,
          status: PageBulkExportJobStatus.failed,
        },
        {
          _id: jobId2,
          user,
          page: new mongoose.Types.ObjectId(),
          format: PageBulkExportFormat.md,
          status: PageBulkExportJobStatus.initializing,
        },
        {
          _id: jobId3,
          user,
          page: new mongoose.Types.ObjectId(),
          format: PageBulkExportFormat.md,
          status: PageBulkExportJobStatus.failed,
        },
      ]);
    });

    test('should delete failed export jobs', async () => {
      expect(await PageBulkExportJob.find()).toHaveLength(3);

      // act
      await pageBulkExportJobCleanUpCronService?.deleteFailedExportJobs();
      const jobs = await PageBulkExportJob.find();

      // assert
      expect(jobs).toHaveLength(1);
      expect(jobs.map((job) => job._id)).toStrictEqual([jobId2]);
    });
  });
});
