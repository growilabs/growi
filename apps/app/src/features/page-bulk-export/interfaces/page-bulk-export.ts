import type {
  HasObjectId,
  IAttachment,
  IPage,
  IRevision,
  IUser,
  Ref,
} from '@growi/core';

export const PageBulkExportFormat = {
  md: 'md',
  pdf: 'pdf',
} as const;

export type PageBulkExportFormat =
  (typeof PageBulkExportFormat)[keyof typeof PageBulkExportFormat];

export const PageBulkExportJobInProgressStatus = {
  initializing: 'initializing', // preparing for export
  exporting: 'exporting', // exporting to fs
  uploading: 'uploading', // uploading to cloud storage
} as const;

export const PageBulkExportJobStatus = {
  ...PageBulkExportJobInProgressStatus,
  completed: 'completed',
  failed: 'failed',
} as const;

export type PageBulkExportJobStatus =
  (typeof PageBulkExportJobStatus)[keyof typeof PageBulkExportJobStatus];

export interface IPageBulkExportJob {
  user: Ref<IUser>; // user that started export job
  page: Ref<IPage>; // the root page of page tree to export
  lastExportedPagePath?: string; // the path of page that was exported to the fs last
  format: PageBulkExportFormat;
  completedAt?: Date; // the date at which job was completed
  attachment?: Ref<IAttachment>;
  status: PageBulkExportJobStatus;
  statusOnPreviousCronExec?: PageBulkExportJobStatus; // status on previous cron execution
  revisionListHash?: string; // Hash created from the list of revision IDs. Used to detect existing duplicate uploads.
  restartFlag: boolean; // flag to restart the job
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IPageBulkExportJobHasId
  extends IPageBulkExportJob,
    HasObjectId {}

// snapshot of page info to upload
export interface IPageBulkExportPageSnapshot {
  pageBulkExportJob: Ref<IPageBulkExportJob>;
  path: string; // page path when export was stared
  revision: Ref<IRevision>; // page revision when export was stared
}
