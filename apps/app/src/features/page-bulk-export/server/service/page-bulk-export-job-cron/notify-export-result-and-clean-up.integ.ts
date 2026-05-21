import mongoose from 'mongoose';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';

import {
  PageBulkExportFormat,
  PageBulkExportJobStatus,
} from '../../../interfaces/page-bulk-export';
import PageBulkExportJob from '../../models/page-bulk-export-job';
import instanciatePageBulkExportJobCronService, {
  pageBulkExportJobCronService,
} from './index';

/**
 * Every completion path must set `completedAt`. The duplicate-reuse path
 * (createPageSnapshotsAsync) marks a job completed without it, which made the
 * download-expiration cleanup unable to ever match the job. `notifyExportResultAndCleanUp`
 * is the single choke point that finalizes the status, so it now backfills `completedAt`.
 */
describe('PageBulkExportJobCronService.notifyExportResultAndCleanUp', () => {
  const crowi = {
    events: { activity: { emit: vi.fn() } },
  } as unknown as Crowi;

  beforeAll(async () => {
    await configManager.loadConfigs();
    instanciatePageBulkExportJobCronService(crowi);
    // Stub out side effects (notification + fs/resource cleanup); we only assert on the job document.
    vi.spyOn(
      // biome-ignore lint/suspicious/noExplicitAny: notifyExportResult is private
      pageBulkExportJobCronService as any,
      'notifyExportResult',
    ).mockResolvedValue(undefined);
    vi.spyOn(
      // biome-ignore lint/style/noNonNullAssertion: instanciated above
      pageBulkExportJobCronService!,
      'cleanUpExportJobResources',
    ).mockResolvedValue(undefined);
  });

  beforeEach(async () => {
    await PageBulkExportJob.deleteMany();
  });

  test('should set completedAt when a job is completed without it (duplicate-reuse path)', async () => {
    // arrange: mimic the reuse path — completed-bound job without completedAt
    const job = await PageBulkExportJob.create({
      user: new mongoose.Types.ObjectId(),
      page: new mongoose.Types.ObjectId(),
      format: PageBulkExportFormat.md,
      status: PageBulkExportJobStatus.exporting,
    });
    expect(job.completedAt).toBeUndefined();

    // act
    await pageBulkExportJobCronService?.notifyExportResultAndCleanUp(
      SupportedAction.ACTION_PAGE_BULK_EXPORT_COMPLETED,
      job,
    );

    // assert
    const updated = await PageBulkExportJob.findById(job._id);
    expect(updated?.status).toBe(PageBulkExportJobStatus.completed);
    expect(updated?.completedAt).toBeInstanceOf(Date);
  });

  test('should preserve an already-set completedAt (normal completion path)', async () => {
    // arrange
    const originalCompletedAt = new Date('2020-01-01T00:00:00.000Z');
    const job = await PageBulkExportJob.create({
      user: new mongoose.Types.ObjectId(),
      page: new mongoose.Types.ObjectId(),
      format: PageBulkExportFormat.md,
      status: PageBulkExportJobStatus.uploading,
      completedAt: originalCompletedAt,
    });

    // act
    await pageBulkExportJobCronService?.notifyExportResultAndCleanUp(
      SupportedAction.ACTION_PAGE_BULK_EXPORT_COMPLETED,
      job,
    );

    // assert
    const updated = await PageBulkExportJob.findById(job._id);
    expect(updated?.completedAt?.toISOString()).toBe(
      originalCompletedAt.toISOString(),
    );
  });

  test('should not set completedAt when the job failed', async () => {
    // arrange
    const job = await PageBulkExportJob.create({
      user: new mongoose.Types.ObjectId(),
      page: new mongoose.Types.ObjectId(),
      format: PageBulkExportFormat.md,
      status: PageBulkExportJobStatus.exporting,
    });

    // act
    await pageBulkExportJobCronService?.notifyExportResultAndCleanUp(
      SupportedAction.ACTION_PAGE_BULK_EXPORT_FAILED,
      job,
    );

    // assert
    const updated = await PageBulkExportJob.findById(job._id);
    expect(updated?.status).toBe(PageBulkExportJobStatus.failed);
    expect(updated?.completedAt).toBeUndefined();
  });
});
