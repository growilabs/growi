import type { HasObjectId, IAttachment, IUser, Ref } from '@growi/core';

import type { SupportedActionType } from '~/interfaces/activity';

export const AuditLogBulkExportFormat = {
  json: 'json',
} as const;

export type AuditLogBulkExportFormat =
  (typeof AuditLogBulkExportFormat)[keyof typeof AuditLogBulkExportFormat];

export const AuditLogBulkExportJobInProgressJobStatus = {
  exporting: 'exporting',
  uploading: 'uploading',
} as const;

export const AuditLogBulkExportJobStatus = {
  ...AuditLogBulkExportJobInProgressJobStatus,
  completed: 'completed',
  failed: 'failed',
} as const;

export type AuditLogBulkExportJobStatus =
  (typeof AuditLogBulkExportJobStatus)[keyof typeof AuditLogBulkExportJobStatus];

export interface IAuditLogBulkExportFilters {
  users?: Array<Ref<IUser>>;
  actions?: SupportedActionType[];
  dateFrom?: Date;
  dateTo?: Date;
}

export interface IAuditLogBulkExportJob {
  user: Ref<IUser>; // user who initiated the audit log export job
  filters: IAuditLogBulkExportFilters; // filter conditions used for export (e.g. user, action, date range)
  filterHash: string; // hash string generated from the filter set to detect duplicate export jobs
  format: AuditLogBulkExportFormat; // export file format (currently only 'json' is supported)
  status: AuditLogBulkExportJobStatus; // current status of the export job
  lastExportedId?: string; // ID of the last exported audit log record
  completedAt?: Date | null; // the date when the job was completed
  restartFlag: boolean; // flag indicating whether this job is a restarted one
  totalExportedCount?: number; // total number of exported audit log entries
  createdAt?: Date;
  updatedAt?: Date;
  attachment?: Ref<IAttachment>;
}

export interface IAuditLogBulkExportJobHasId
  extends IAuditLogBulkExportJob,
    HasObjectId {}
