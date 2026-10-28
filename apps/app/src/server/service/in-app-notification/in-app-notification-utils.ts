import type { IPage, IUser } from '@growi/core';

import type { IAuditLogBulkExportJob } from '~/features/audit-log-bulk-export/interfaces/audit-log-bulk-export';
import type { pagebulkexportjobs } from '~/generated/prisma/client';
import { SupportedTargetModel } from '~/interfaces/activity';
import * as pageSerializers from '~/models/serializers/in-app-notification-snapshot/page';
import * as pageBulkExportJobSerializers from '~/models/serializers/in-app-notification-snapshot/page-bulk-export-job';

const isIPage = (
  targetModel: string,
  target: IUser | IPage | pagebulkexportjobs | IAuditLogBulkExportJob,
): target is IPage => {
  return targetModel === SupportedTargetModel.MODEL_PAGE;
};

const isIPageBulkExportJob = (
  targetModel: string,
  target: IUser | IPage | pagebulkexportjobs | IAuditLogBulkExportJob,
): target is pagebulkexportjobs => {
  return targetModel === SupportedTargetModel.MODEL_PAGE_BULK_EXPORT_JOB;
};

// snapshots are infos about the target that are displayed in the notification, which should not change on target update/deletion
export const generateSnapshot = async (
  targetModel: string,
  target: IUser | IPage | pagebulkexportjobs | IAuditLogBulkExportJob,
): Promise<string | undefined> => {
  let snapshot: string | undefined;

  if (isIPage(targetModel, target)) {
    snapshot = pageSerializers.stringifySnapshot(target);
  } else if (isIPageBulkExportJob(targetModel, target)) {
    snapshot = await pageBulkExportJobSerializers.stringifySnapshot(target);
  }

  return snapshot;
};
