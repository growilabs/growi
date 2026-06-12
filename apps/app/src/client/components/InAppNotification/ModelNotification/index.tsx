import type { FC } from 'react';
import type { HasObjectId } from '@growi/core';

import type { IInAppNotification } from '~/interfaces/in-app-notification';

import { useAuditLogBulkExportJobModelNotification } from './AuditLogBulkExportJobModelNotification';
import { usePageBulkExportJobModelNotification } from './PageBulkExportJobModelNotification';
import { usePageModelNotification } from './PageModelNotification';
import { useUserModelNotification } from './UserModelNotification';

export interface ModelNotificationUtils {
  Notification: FC;
  publishOpen?: () => void;
  clickLink?: string;
  // Whether actions from clicking notification is disabled or not.
  // User can still open the notification when true.
  isDisabled?: boolean;
}

export const useModelNotification = (
  notification: IInAppNotification & HasObjectId,
): ModelNotificationUtils | null => {
  const pageModelNotificationUtils = usePageModelNotification(notification);
  const userModelNotificationUtils = useUserModelNotification(notification);
  const pageBulkExportResultModelNotificationUtils =
    usePageBulkExportJobModelNotification(notification);
  const auditLogBulkExportJobModelNotificationUtils =
    useAuditLogBulkExportJobModelNotification(notification);

  const modelNotificationUtils =
    pageModelNotificationUtils ??
    userModelNotificationUtils ??
    pageBulkExportResultModelNotificationUtils ??
    auditLogBulkExportJobModelNotificationUtils;

  return modelNotificationUtils;
};
