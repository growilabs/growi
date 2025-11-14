import type { IUser } from '@growi/core';
import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';

import {
  AuditLogBulkExportFormat,
  AuditLogBulkExportJobStatus,
} from '../../interfaces/audit-log-bulk-export';
import AuditLogBulkExportJob from '../models/audit-log-bulk-export-job';

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
  const crowi = {} as Crowi;
  let user: IUser;

  beforeAll(async () => {
    await configManager.loadConfigs();
    user = await User.create({
      name: 'Example for AuditLogBulkExportJobCleanUpCronService Test',
      username: 'audit log bulk export job cleanup cron test user',
      email: 'auditLogBulkExportCleanUpCronTestUser@example.com',
    });
    instantiateAuditLogBulkExportJobCleanUpCronService(crowi);
  });

  beforeEach(async () => {
    await AuditLogBulkExportJob.deleteMany();
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

      await AuditLogBulkExportJob.insertMany([
        {
          _id: jobId1,
          user,
          filters: {},
          filterHash: 'hash1',
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.exporting,
          restartFlag: false,
          createdAt: new Date(Date.now()),
        },
        {
          _id: jobId2,
          user,
          filters: {},
          filterHash: 'hash2',
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.exporting,
          restartFlag: false,
          createdAt: new Date(Date.now() - 86400 * 1000 - 1),
        },
        {
          _id: jobId3,
          user,
          filters: {},
          filterHash: 'hash3',
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.uploading,
          restartFlag: false,
          createdAt: new Date(Date.now() - 86400 * 1000 - 2),
        },
        {
          _id: jobId4,
          user,
          filters: {},
          filterHash: 'hash4',
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.failed,
          restartFlag: false,
        },
      ]);
    });

    test('should delete expired jobs', async () => {
      expect(await AuditLogBulkExportJob.find()).toHaveLength(4);

      await auditLogBulkExportJobCleanUpCronService?.deleteExpiredExportJobs();
      const jobs = await AuditLogBulkExportJob.find();

      expect(jobs).toHaveLength(2);
      expect(jobs.map((job) => job._id).sort()).toStrictEqual(
        [jobId1, jobId4].sort(),
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

      await AuditLogBulkExportJob.insertMany([
        {
          _id: jobId1,
          user,
          filters: {},
          filterHash: 'hash1',
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.completed,
          restartFlag: false,
          completedAt: new Date(Date.now()),
        },
        {
          _id: jobId2,
          user,
          filters: {},
          filterHash: 'hash2',
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.completed,
          restartFlag: false,
          completedAt: new Date(Date.now() - 86400 * 1000 - 1),
        },
        {
          _id: jobId3,
          user,
          filters: {},
          filterHash: 'hash3',
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.exporting,
          restartFlag: false,
        },
        {
          _id: jobId4,
          user,
          filters: {},
          filterHash: 'hash4',
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.failed,
          restartFlag: false,
        },
      ]);
    });

    test('should delete download expired jobs', async () => {
      expect(await AuditLogBulkExportJob.find()).toHaveLength(4);

      await auditLogBulkExportJobCleanUpCronService?.deleteDownloadExpiredExportJobs();
      const jobs = await AuditLogBulkExportJob.find();

      expect(jobs).toHaveLength(3);
      expect(jobs.map((job) => job._id).sort()).toStrictEqual(
        [jobId1, jobId3, jobId4].sort(),
      );
    });
  });

  describe('deleteFailedExportJobs', () => {
    const jobId1 = new mongoose.Types.ObjectId();
    const jobId2 = new mongoose.Types.ObjectId();
    const jobId3 = new mongoose.Types.ObjectId();
    beforeEach(async () => {
      await AuditLogBulkExportJob.insertMany([
        {
          _id: jobId1,
          user,
          filters: {},
          filterHash: 'hash1',
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.failed,
          restartFlag: false,
        },
        {
          _id: jobId2,
          user,
          filters: {},
          filterHash: 'hash2',
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.exporting,
          restartFlag: false,
        },
        {
          _id: jobId3,
          user,
          filters: {},
          filterHash: 'hash3',
          format: AuditLogBulkExportFormat.json,
          status: AuditLogBulkExportJobStatus.failed,
          restartFlag: false,
        },
      ]);
    });

    test('should delete failed export jobs', async () => {
      expect(await AuditLogBulkExportJob.find()).toHaveLength(3);

      await auditLogBulkExportJobCleanUpCronService?.deleteFailedExportJobs();
      const jobs = await AuditLogBulkExportJob.find();

      expect(jobs).toHaveLength(1);
      expect(jobs.map((job) => job._id)).toStrictEqual([jobId2]);
    });
  });
});
