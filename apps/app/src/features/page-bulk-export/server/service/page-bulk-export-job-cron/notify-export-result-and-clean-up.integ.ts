import type { EventEmitter } from 'node:events';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

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
  // `mock<Crowi>` auto-stubs `crowi.activityService.createActivity` (called by the
  // private `notifyExportResult`). `events.activity` is the source `this.activityEvent`
  // is bound to in the service constructor, so stubbing it here is enough to silence
  // `this.activityEvent.emit('updated', ...)` without spying on the private method.
  const crowi = mock<Crowi>({
    events: {
      activity: mock<EventEmitter>(),
    },
  });

  beforeAll(async () => {
    await configManager.loadConfigs();
    instanciatePageBulkExportJobCronService(crowi);
    // The fs/resource cleanup step is unrelated to the completedAt contract under test.
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
    // arrange: the only precondition the bug requires is "completedAt is null on entry";
    // the initial status is irrelevant because notifyExportResultAndCleanUp overwrites it
    // from the action argument. (Real duplicate-reuse path enters with status=completed,
    // simplified to status=exporting here.)
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

  // JOB_EXPIRED is a third action that flows through the same choke point.
  // Under the current branch (`action === COMPLETED`) it is equivalent to
  // FAILED, but pinning it ensures a future split between the two does not
  // silently start backfilling completedAt on expired jobs.
  test('should not set completedAt when the job expired', async () => {
    // arrange
    const job = await PageBulkExportJob.create({
      user: new mongoose.Types.ObjectId(),
      page: new mongoose.Types.ObjectId(),
      format: PageBulkExportFormat.md,
      status: PageBulkExportJobStatus.exporting,
    });

    // act
    await pageBulkExportJobCronService?.notifyExportResultAndCleanUp(
      SupportedAction.ACTION_PAGE_BULK_EXPORT_JOB_EXPIRED,
      job,
    );

    // assert
    const updated = await PageBulkExportJob.findById(job._id);
    expect(updated?.status).toBe(PageBulkExportJobStatus.failed);
    expect(updated?.completedAt).toBeUndefined();
  });
});
