import type { PageBulkExportJobDocument } from '../../models/page-bulk-export-job';

export class BulkExportJobExpiredError extends Error {
  constructor(pageBulkExportJob: PageBulkExportJobDocument) {
    super(`Bulk export job has expired: ${pageBulkExportJob._id.toString()}`);
  }
}

export class BulkExportJobStreamDestroyedByCleanupError extends Error {
  constructor() {
    super('Bulk export job stream was destroyed by cleanup');
  }
}
