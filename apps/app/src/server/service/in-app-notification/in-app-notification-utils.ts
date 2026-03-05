import type { IPage, IUser } from '@growi/core';

import type { IPageBulkExportJob } from '~/features/page-bulk-export/interfaces/page-bulk-export';
import { SupportedTargetModel } from '~/interfaces/activity';
import * as pageSerializers from '~/models/serializers/in-app-notification-snapshot/page';
import * as pageBulkExportJobSerializers from '~/models/serializers/in-app-notification-snapshot/page-bulk-export-job';

const isIPage = (
  targetModel: string,
  target: IUser | IPage | IPageBulkExportJob,
): target is IPage => {
  return targetModel === SupportedTargetModel.MODEL_PAGE;
};

const isIPageBulkExportJob = (
  targetModel: string,
  target: IUser | IPage | IPageBulkExportJob,
): target is IPageBulkExportJob => {
  return targetModel === SupportedTargetModel.MODEL_PAGE_BULK_EXPORT_JOB;
};

// snapshots are infos about the target that are displayed in the notification, which should not change on target update/deletion
export const generateSnapshot = async (
  targetModel: string,
  target: IUser | IPage | IPageBulkExportJob,
): Promise<string | undefined> => {
  let snapshot: string | undefined;

  if (isIPage(targetModel, target)) {
    snapshot = pageSerializers.stringifySnapshot(target);
  } else if (isIPageBulkExportJob(targetModel, target)) {
    snapshot = await pageBulkExportJobSerializers.stringifySnapshot(target);
  }

  return snapshot;
};
