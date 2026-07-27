import React, { useCallback } from 'react';
import { useRouter } from 'next/router';
import type { HasObjectId, IPage } from '@growi/core';

import { SupportedTargetModel } from '~/interfaces/activity';
import type { IInAppNotification } from '~/interfaces/in-app-notification';
import * as pageSerializers from '~/models/serializers/in-app-notification-snapshot/page';

import type { ModelNotificationUtils } from '.';
import { buildActionUsersLabel } from './build-action-users-label';
import { ModelNotification } from './ModelNotification';
import { useActionMsgAndIconForModelNotification } from './useActionAndMsg';

export const usePageModelNotification = (
  notification: IInAppNotification & HasObjectId,
): ModelNotificationUtils | null => {
  const router = useRouter();
  const { actionMsg, actionIcon } =
    useActionMsgAndIconForModelNotification(notification);

  const getActionUsers = useCallback(
    () => buildActionUsersLabel(notification.actionUsers),
    [notification.actionUsers],
  );

  const isPageModelNotification = (
    notification: IInAppNotification & HasObjectId,
  ): notification is IInAppNotification<IPage> & HasObjectId => {
    return notification.targetModel === SupportedTargetModel.MODEL_PAGE;
  };

  if (!isPageModelNotification(notification)) {
    return null;
  }

  const actionUsers = getActionUsers();

  notification.parsedSnapshot = pageSerializers.parseSnapshot(
    notification.snapshot,
  );

  const Notification = () => {
    return (
      <ModelNotification
        notification={notification}
        actionMsg={actionMsg}
        actionIcon={actionIcon}
        actionUsers={actionUsers}
      />
    );
  };

  const publishOpen = () => {
    if (notification.target != null) {
      // jump to target page
      const targetPagePath = (notification.target as IPage).path;
      if (targetPagePath != null) {
        router.push(targetPagePath);
      }
    }
  };

  return {
    Notification,
    publishOpen,
  };
};
