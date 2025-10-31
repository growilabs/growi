export class AuditLogExportJobExpiredError extends Error {

  constructor() {
    super('Audit-log export job has expired');
  }

}

export class AuditLogExportJobRestartedError extends Error {

  constructor() {
    super('Audit-log export job has restarted');
  }

}
