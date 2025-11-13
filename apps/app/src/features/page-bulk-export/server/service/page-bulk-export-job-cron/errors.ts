export class BulkExportJobExpiredError extends Error {
  constructor() {
    super('Bulk export job has expired');
  }
}

export class BulkExportJobRestartedError extends Error {
  constructor() {
    super('Bulk export job has restarted');
  }
}
