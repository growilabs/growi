import type {
  HasObjectId,
  IAttachment,
  IUser,
  Ref,
} from '@growi/core';

export const AuditLogExportFormat = {
  json: 'json',
} as const;
export type AuditLogExportFormat =
  (typeof AuditLogExportFormat)[keyof typeof AuditLogExportFormat];

export const AuditLogExportJobInProgressStatus = {
  // initializing: 'initializing',
  exporting: 'exporting',
  uploading: 'uploading',
} as const;

export const AuditLogExportJobStatus = {
  ...AuditLogExportJobInProgressStatus,
  completed: 'completed',
  failed: 'failed',
} as const;
export type AuditLogExportJobStatus =
  (typeof AuditLogExportJobStatus)[keyof typeof AuditLogExportJobStatus];

export interface IAuditLogExportFilters {
  users?: Array<Ref<IUser>>;
  actions?: string[];
  dateFrom?: Date;
  dateTo?: Date;
}

export interface IAuditLogExportJob {
  user: Ref<IUser>;
  filters: IAuditLogExportFilters;
  filterHash: string;
  format: AuditLogExportFormat;
  status: AuditLogExportJobStatus;
  statusOnPreviousCronExec?: AuditLogExportJobStatus;
  upperBoundAt?: Date;
  lastExportedAt?: Date;
  lastExportedId?: string;
  completedAt?: Date | null;
  attachment?: Ref<IAttachment>;
  matchSignature?: string;
  restartFlag: boolean;
  totalExportedCount?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IAuditLogExportJobHasId
  extends IAuditLogExportJob, HasObjectId {}
