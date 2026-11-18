import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type { Prisma } from '~/generated/prisma/client';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import {
  PageBulkExportFormat,
  PageBulkExportJobStatus,
} from '../../../../interfaces/page-bulk-export';
import type { IPageBulkExportJobCronService } from '..';
import { reuseDuplicateExportIfExists } from './create-page-snapshots-async';

type JobOverrides = Partial<Prisma.pagebulkexportjobsUncheckedCreateInput>;

const newObjectIdString = () => new mongoose.Types.ObjectId().toString();

describe('reuseDuplicateExportIfExists', () => {
  const userId = newObjectIdString();
  const pageId = newObjectIdString();
  const revisionListHash = 'same-revision-list';
  const dayMs = 86400 * 1000;

  let cronService: IPageBulkExportJobCronService;
  let downloadExpirationMs: number;

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

  const createJob = (data: JobOverrides) =>
    prisma.pagebulkexportjobs.create({
      data: {
        userId,
        pageId,
        format: PageBulkExportFormat.md,
        status: PageBulkExportJobStatus.exporting,
        revisionListHash,
        ...data,
      },
    });

  const createCompletedSibling = (data: JobOverrides) =>
    createJob({
      status: PageBulkExportJobStatus.completed,
      completedAt: new Date(),
      ...data,
    });

  beforeAll(async () => {
    await configManager.loadConfigs();
    downloadExpirationMs =
      configManager.getConfig('app:bulkExportDownloadExpirationSeconds') * 1000;
  });

  beforeEach(async () => {
    await prisma.pagebulkexportjobs.deleteMany();
    await prisma.attachments.deleteMany();
    cronService = mock<IPageBulkExportJobCronService>();
  });

  test('completes the job with the attachment of a completed job that is still downloadable', async () => {
    const attachment = await createAttachment();
    await createCompletedSibling({ attachmentId: attachment.id });
    const job = await createJob({});

    await reuseDuplicateExportIfExists.call(cronService, job);

    const reused = await prisma.pagebulkexportjobs.findUnique({
      where: { id: job.id },
    });
    expect(reused?.status).toBe(PageBulkExportJobStatus.completed);
    expect(reused?.attachmentId).toBe(attachment.id);
    expect(reused?.completedAt).not.toBeNull();
    expect(cronService.notifyExportResultAndCleanUp).toHaveBeenCalledTimes(1);
  });

  test('does not reuse a completed job whose attachment is gone', async () => {
    await createCompletedSibling({ attachmentId: null });
    const job = await createJob({});

    await reuseDuplicateExportIfExists.call(cronService, job);

    const untouched = await prisma.pagebulkexportjobs.findUnique({
      where: { id: job.id },
    });
    expect(untouched?.status).toBe(PageBulkExportJobStatus.exporting);
    expect(untouched?.attachmentId).toBeNull();
    expect(cronService.notifyExportResultAndCleanUp).not.toHaveBeenCalled();
  });

  test('does not reuse a completed job whose download has expired', async () => {
    const attachment = await createAttachment();
    await createCompletedSibling({
      attachmentId: attachment.id,
      completedAt: new Date(Date.now() - downloadExpirationMs - dayMs),
    });
    const job = await createJob({});

    await reuseDuplicateExportIfExists.call(cronService, job);

    const untouched = await prisma.pagebulkexportjobs.findUnique({
      where: { id: job.id },
    });
    expect(untouched?.status).toBe(PageBulkExportJobStatus.exporting);
    expect(cronService.notifyExportResultAndCleanUp).not.toHaveBeenCalled();
  });

  test('does not reuse a completed job that exported different revisions', async () => {
    const attachment = await createAttachment();
    await createCompletedSibling({
      attachmentId: attachment.id,
      revisionListHash: 'other-revision-list',
    });
    const job = await createJob({});

    await reuseDuplicateExportIfExists.call(cronService, job);

    expect(cronService.notifyExportResultAndCleanUp).not.toHaveBeenCalled();
  });
});
