import mongoose from 'mongoose';

import type { SupportedActionType } from '~/interfaces/activity';
import { configManager } from '~/server/service/config-manager';

import {
  AuditLogBulkExportFormat,
  AuditLogBulkExportJobStatus,
} from '../../interfaces/audit-log-bulk-export';
import AuditLogBulkExportJob from '../models/audit-log-bulk-export-job';
import {
  auditLogBulkExportService,
  DuplicateAuditLogBulkExportJobError,
} from './audit-log-bulk-export';

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

describe('AuditLogBulkExportService', () => {
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let user;

  beforeAll(async () => {
    await configManager.loadConfigs();
    user = await User.create({
      name: 'Example for AuditLogBulkExportService Test',
      username: 'audit bulk export test user',
      email: 'auditBulkExportTestUser@example.com',
    });
  });

  afterEach(async () => {
    await AuditLogBulkExportJob.deleteMany({});
  });

  afterAll(async () => {
    await User.deleteOne({ _id: user._id });
  });

  describe('createOrResetExportJob', () => {
    describe('normal cases', () => {
      it('should create a new export job with valid parameters', async () => {
        const filters: {
          actions: SupportedActionType[];
          dateFrom: Date;
          dateTo: Date;
        } = {
          actions: ['PAGE_VIEW', 'PAGE_CREATE'],
          dateFrom: new Date('2023-01-01'),
          dateTo: new Date('2023-12-31'),
        };

        const jobId = await auditLogBulkExportService.createOrResetExportJob(
          filters,
          AuditLogBulkExportFormat.json,
          user._id,
        );

        expect(jobId).toMatch(/^[0-9a-fA-F]{24}$/);

        const createdJob = await AuditLogBulkExportJob.findById(jobId);
        expect(createdJob).toBeDefined();
        expect(createdJob?.user).toEqual(user._id);
        expect(createdJob?.format).toBe(AuditLogBulkExportFormat.json);
        expect(createdJob?.status).toBe(AuditLogBulkExportJobStatus.exporting);
        expect(createdJob?.totalExportedCount).toBe(0);
        expect(createdJob?.filters).toMatchObject({
          actions: ['PAGE_CREATE', 'PAGE_VIEW'],
          dateFrom: new Date('2023-01-01T00:00:00.000Z'),
          dateTo: new Date('2023-12-31T00:00:00.000Z'),
        });
      });

      it('should create a job with minimal filters', async () => {
        const filters: { actions: SupportedActionType[] } = {
          actions: ['PAGE_VIEW'],
        };

        const jobId = await auditLogBulkExportService.createOrResetExportJob(
          filters,
          AuditLogBulkExportFormat.json,
          user._id,
        );

        const createdJob = await AuditLogBulkExportJob.findById(jobId);
        expect(createdJob).toBeDefined();
        expect(createdJob?.format).toBe(AuditLogBulkExportFormat.json);
        expect(createdJob?.filters).toMatchObject({
          actions: ['PAGE_VIEW'],
        });
      });

      it('should create a job with user filters', async () => {
        const filters: { users: string[]; actions: SupportedActionType[] } = {
          users: [user._id.toString()],
          actions: ['PAGE_CREATE'],
        };

        const jobId = await auditLogBulkExportService.createOrResetExportJob(
          filters,
          AuditLogBulkExportFormat.json,
          user._id,
        );

        const createdJob = await AuditLogBulkExportJob.findById(jobId);
        expect(createdJob?.filters.actions).toEqual(['PAGE_CREATE']);
        expect(createdJob?.filters.users?.map(String)).toEqual([
          user._id.toString(),
        ]);
      });

      it('should reset existing job when restartJob is true', async () => {
        const filters: { actions: SupportedActionType[] } = {
          actions: ['PAGE_VIEW'],
        };

        const firstJobId =
          await auditLogBulkExportService.createOrResetExportJob(
            filters,
            AuditLogBulkExportFormat.json,
            user._id,
          );

        const secondJobId =
          await auditLogBulkExportService.createOrResetExportJob(
            filters,
            AuditLogBulkExportFormat.json,
            user._id,
            true,
          );

        expect(secondJobId).toBe(firstJobId);

        const job = await AuditLogBulkExportJob.findById(firstJobId);
        expect(job?.restartFlag).toBe(true);
      });
    });

    describe('error cases', () => {
      it('should throw DuplicateAuditLogBulkExportJobError when duplicate job exists', async () => {
        const filters: { actions: SupportedActionType[] } = {
          actions: ['PAGE_VIEW'],
        };

        await auditLogBulkExportService.createOrResetExportJob(
          filters,
          AuditLogBulkExportFormat.json,
          user._id,
        );

        await expect(
          auditLogBulkExportService.createOrResetExportJob(
            filters,
            AuditLogBulkExportFormat.json,
            user._id,
          ),
        ).rejects.toThrow(DuplicateAuditLogBulkExportJobError);
      });

      it('should allow creating job with same filters for different user', async () => {
        const anotherUser = await User.create({
          name: 'Another User',
          username: 'another user',
          email: 'another@example.com',
        });

        const filters: { actions: SupportedActionType[] } = {
          actions: ['PAGE_VIEW'],
        };

        const firstJobId =
          await auditLogBulkExportService.createOrResetExportJob(
            filters,
            AuditLogBulkExportFormat.json,
            user._id,
          );

        const secondJobId =
          await auditLogBulkExportService.createOrResetExportJob(
            filters,
            AuditLogBulkExportFormat.json,
            anotherUser._id,
          );

        expect(firstJobId).not.toBe(secondJobId);

        await User.deleteOne({ _id: anotherUser._id });
      });

      it('should allow creating job with different filters for same user', async () => {
        const firstFilters: { actions: SupportedActionType[] } = {
          actions: ['PAGE_VIEW'],
        };
        const secondFilters: { actions: SupportedActionType[] } = {
          actions: ['PAGE_CREATE'],
        };

        const firstJobId =
          await auditLogBulkExportService.createOrResetExportJob(
            firstFilters,
            AuditLogBulkExportFormat.json,
            user._id,
          );

        const secondJobId =
          await auditLogBulkExportService.createOrResetExportJob(
            secondFilters,
            AuditLogBulkExportFormat.json,
            user._id,
          );

        expect(firstJobId).not.toBe(secondJobId);
      });

      it('should not throw error if previous job is completed', async () => {
        const filters: { actions: SupportedActionType[] } = {
          actions: ['PAGE_VIEW'],
        };

        const firstJobId =
          await auditLogBulkExportService.createOrResetExportJob(
            filters,
            AuditLogBulkExportFormat.json,
            user._id,
          );

        const firstJob = await AuditLogBulkExportJob.findById(firstJobId);
        if (firstJob) {
          firstJob.status = AuditLogBulkExportJobStatus.completed;
          await firstJob.save();
        }

        const secondJobId =
          await auditLogBulkExportService.createOrResetExportJob(
            filters,
            AuditLogBulkExportFormat.json,
            user._id,
          );

        expect(secondJobId).not.toBe(firstJobId);
      });
    });
  });

  describe('resetExportJob', () => {
    it('should set restartFlag to true', async () => {
      const filters = { actions: ['PAGE_VIEW'] as SupportedActionType[] };

      const jobId = await auditLogBulkExportService.createOrResetExportJob(
        filters,
        AuditLogBulkExportFormat.json,
        user._id,
      );

      const job = await AuditLogBulkExportJob.findById(jobId);
      expect(job?.restartFlag).toBeFalsy();

      if (job) {
        await auditLogBulkExportService.resetExportJob(job);
      }

      const updatedJob = await AuditLogBulkExportJob.findById(jobId);
      expect(updatedJob?.restartFlag).toBe(true);
    });
  });

  describe('filter canonicalization', () => {
    it('should generate same job for logically equivalent filters', async () => {
      const validUserId1 = new mongoose.Types.ObjectId().toString();
      const validUserId2 = new mongoose.Types.ObjectId().toString();

      const filters1: { actions: SupportedActionType[]; users: string[] } = {
        actions: ['PAGE_VIEW', 'PAGE_CREATE'],
        users: [validUserId1, validUserId2],
      };

      const filters2: { actions: SupportedActionType[]; users: string[] } = {
        actions: ['PAGE_CREATE', 'PAGE_VIEW'],
        users: [validUserId2, validUserId1],
      };

      await auditLogBulkExportService.createOrResetExportJob(
        filters1,
        AuditLogBulkExportFormat.json,
        user._id,
      );

      await expect(
        auditLogBulkExportService.createOrResetExportJob(
          filters2,
          AuditLogBulkExportFormat.json,
          user._id,
        ),
      ).rejects.toThrow(DuplicateAuditLogBulkExportJobError);
    });

    it('should normalize date formats consistently', async () => {
      const dateString = '2023-01-01T00:00:00.000Z';
      const dateObject = new Date(dateString);

      const filters1: { actions: SupportedActionType[]; dateFrom: Date } = {
        actions: ['PAGE_VIEW'],
        dateFrom: new Date(dateString),
      };

      const filters2: { actions: SupportedActionType[]; dateFrom: Date } = {
        actions: ['PAGE_VIEW'],
        dateFrom: dateObject,
      };

      await auditLogBulkExportService.createOrResetExportJob(
        filters1,
        AuditLogBulkExportFormat.json,
        user._id,
      );

      await expect(
        auditLogBulkExportService.createOrResetExportJob(
          filters2,
          AuditLogBulkExportFormat.json,
          user._id,
        ),
      ).rejects.toThrow(DuplicateAuditLogBulkExportJobError);
    });
  });
});
