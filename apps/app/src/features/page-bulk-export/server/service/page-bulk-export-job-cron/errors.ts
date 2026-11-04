import type { pagebulkexportjobs } from '~/generated/prisma/client';

export class BulkExportJobExpiredError extends Error {
  constructor(pageBulkExportJob: pagebulkexportjobs) {
    super(`Bulk export job has expired: ${pageBulkExportJob.id}`);
  }
}

export class BulkExportJobStreamDestroyedByCleanupError extends Error {
  constructor() {
    super('Bulk export job stream was destroyed by cleanup');
  }
}
