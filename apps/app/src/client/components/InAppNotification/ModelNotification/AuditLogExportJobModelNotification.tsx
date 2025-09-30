import React from 'react';

import { isPopulated, type HasObjectId } from '@growi/core';
import { useTranslation } from 'react-i18next';

import type { IAuditLogExportJobHasId } from '~/features/audit-log-export/interfaces/audit-log-bulk-export';
import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type { IInAppNotification } from '~/interfaces/in-app-notification';
import * as auditLogExportJobSerializers from '~/models/serializers/in-app-notification-snapshot/audit-log-export-job';

import { ModelNotification } from './ModelNotification';
import { useActionMsgAndIconForModelNotification } from './useActionAndMsg';

import type { ModelNotificationUtils } from '.';


export const useAuditLogExportJobModelNotification = (notification: IInAppNotification & HasObjectId): ModelNotificationUtils | null => {

  const { t } = useTranslation();
  const { actionMsg, actionIcon } = useActionMsgAndIconForModelNotification(notification);

  const isAuditLogExportJobModelNotification = (
      notification: IInAppNotification & HasObjectId,
  ): notification is IInAppNotification<IAuditLogExportJobHasId> & HasObjectId => {
    return notification.targetModel === SupportedTargetModel.MODEL_AUDIT_LOG_EXPORT_JOB;
  };

  if (!isAuditLogExportJobModelNotification(notification)) {
    return null;
  }

  const actionUsers = notification.user.username;

  try {
    notification.parsedSnapshot = auditLogExportJobSerializers.parseSnapshot(notification.snapshot);
  } catch (error) {
    console.error('Error parsing audit log export job notification:', error, notification);
    return null;
  }

  const getSubMsg = (): JSX.Element => {
    if (notification.action === SupportedAction.ACTION_AUDIT_LOG_EXPORT_COMPLETED && notification.target == null) {
      return <div className="text-danger"><small>Audit log export download has expired</small></div>;
    }
    if (notification.action === SupportedAction.ACTION_AUDIT_LOG_EXPORT_JOB_EXPIRED) {
      return <div className="text-danger"><small>Audit log export job has expired</small></div>;
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

  const clickLink = (notification.action === SupportedAction.ACTION_AUDIT_LOG_EXPORT_COMPLETED
    && notification.target?.attachment != null && isPopulated(notification.target?.attachment))
    ? notification.target.attachment.downloadPathProxied : undefined;

  return {
    Notification,
    clickLink,
    isDisabled: notification.target == null,
  };

};