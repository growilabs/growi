import { type HasObjectId, isPopulated } from '@growi/core';
import { useTranslation } from 'react-i18next';

import type { IPageBulkExportJobHasId } from '~/features/page-bulk-export/interfaces/page-bulk-export';
import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type { IInAppNotification } from '~/interfaces/in-app-notification';
import * as pageBulkExportJobSerializers from '~/models/serializers/in-app-notification-snapshot/page-bulk-export-job-client';

import type { ModelNotificationUtils } from '.';
import { ModelNotification } from './ModelNotification';
import { useActionMsgAndIconForModelNotification } from './useActionAndMsg';

export const usePageBulkExportJobModelNotification = (
  notification: IInAppNotification & HasObjectId,
): ModelNotificationUtils | null => {
  const { t } = useTranslation();
  const { actionMsg, actionIcon } =
    useActionMsgAndIconForModelNotification(notification);

  const isPageBulkExportJobModelNotification = (
    notification: IInAppNotification & HasObjectId,
  ): notification is IInAppNotification<IPageBulkExportJobHasId> &
    HasObjectId => {
    return (
      notification.targetModel ===
      SupportedTargetModel.MODEL_PAGE_BULK_EXPORT_JOB
    );
  };

  if (!isPageBulkExportJobModelNotification(notification)) {
    return null;
  }

  const actionUsers = notification.user.username;

  notification.parsedSnapshot = pageBulkExportJobSerializers.parseSnapshot(
    notification.snapshot,
  );

  const getSubMsg = (): JSX.Element => {
    if (
      notification.action ===
        SupportedAction.ACTION_PAGE_BULK_EXPORT_COMPLETED &&
      notification.target == null
    ) {
      return (
        <div className="text-danger">
          <small>{t('page_export.bulk_export_download_expired')}</small>
        </div>
      );
    }
    if (
      notification.action ===
      SupportedAction.ACTION_PAGE_BULK_EXPORT_JOB_EXPIRED
    ) {
      return (
        <div className="text-danger">
          <small>{t('page_export.bulk_export_job_expired')}</small>
        </div>
      );
    }
    return <></>;
  };

  const Notification = () => {
    return (
      <ModelNotification
        notification={notification}
        actionMsg={actionMsg}
        actionIcon={actionIcon}
        actionUsers={actionUsers}
        hideActionUsers
        subMsg={getSubMsg()}
      />
    );
  };

  const clickLink =
    notification.action === SupportedAction.ACTION_PAGE_BULK_EXPORT_COMPLETED &&
    notification.target?.attachment != null &&
    isPopulated(notification.target?.attachment)
      ? notification.target.attachment.downloadPathProxied
      : undefined;

  return {
    Notification,
    clickLink,
    isDisabled: notification.target == null,
  };
};
