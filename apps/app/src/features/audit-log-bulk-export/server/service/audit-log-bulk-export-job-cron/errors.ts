export class AuditLogBulkExportJobExpiredError extends Error {
  constructor() {
    super('Audit-log-bulk-export job has expired');
  }
}

export class AuditLogBulkExportJobRestartedError extends Error {
  constructor() {
    super('Audit-log-bulk-export job has restarted');
  }
}
