import React from 'react';
import { type HasObjectId, isPopulated } from '@growi/core';
import { useTranslation } from 'react-i18next';

import type { IAuditLogBulkExportJobHasId } from '~/features/audit-log-bulk-export/interfaces/audit-log-bulk-export';
import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type { IInAppNotification } from '~/interfaces/in-app-notification';

import type { ModelNotificationUtils } from '.';
import { ModelNotification } from './ModelNotification';
import { useActionMsgAndIconForModelNotification } from './useActionAndMsg';

export const useAuditLogBulkExportJobModelNotification = (
  notification: IInAppNotification & HasObjectId,
): ModelNotificationUtils | null => {
  const { t } = useTranslation();
  const { actionMsg, actionIcon } =
    useActionMsgAndIconForModelNotification(notification);

  const isAuditLogBulkExportJobModelNotification = (
    notification: IInAppNotification & HasObjectId,
  ): notification is IInAppNotification<IAuditLogBulkExportJobHasId> &
    HasObjectId => {
    return (
      notification.targetModel ===
      SupportedTargetModel.MODEL_AUDIT_LOG_BULK_EXPORT_JOB
    );
  };

  if (!isAuditLogBulkExportJobModelNotification(notification)) {
    return null;
  }

  const actionUsers = notification.user.username;

  const getSubMsg = (): JSX.Element => {
    if (
      notification.action ===
        SupportedAction.ACTION_AUDIT_LOG_BULK_EXPORT_COMPLETED &&
      notification.target == null
    ) {
      return (
        <div className="text-danger">
          <small>{t('audit_log_bulk_export.download_expired')}</small>
        </div>
      );
    }
    if (
      notification.action ===
      SupportedAction.ACTION_AUDIT_LOG_BULK_EXPORT_JOB_EXPIRED
    ) {
      return (
        <div className="text-danger">
          <small>{t('audit_log_bulk_export.job_expired')}</small>
        </div>
      );
    }
    if (
      notification.action ===
      SupportedAction.ACTION_AUDIT_LOG_BULK_EXPORT_NO_RESULTS
    ) {
      return (
        <div className="text-danger">
          <small>{t('audit_log_bulk_export.no_results')}</small>
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
        hidePath
        subMsg={getSubMsg()}
      />
    );
  };

  const clickLink =
    notification.action ===
      SupportedAction.ACTION_AUDIT_LOG_BULK_EXPORT_COMPLETED &&
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
