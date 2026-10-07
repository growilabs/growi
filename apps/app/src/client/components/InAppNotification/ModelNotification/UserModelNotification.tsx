import React from 'react';
import { useRouter } from 'next/router';
import type { HasObjectId, IUser } from '@growi/core';

import { SupportedTargetModel } from '~/interfaces/activity';
import type { IInAppNotification } from '~/interfaces/in-app-notification';

import type { ModelNotificationUtils } from '.';
import { ModelNotification } from './ModelNotification';
import { useActionMsgAndIconForModelNotification } from './useActionAndMsg';

export const useUserModelNotification = (
  notification: IInAppNotification & HasObjectId,
): ModelNotificationUtils | null => {
  const { actionMsg, actionIcon } =
    useActionMsgAndIconForModelNotification(notification);
  const router = useRouter();

  const isUserModelNotification = (
    notification: IInAppNotification & HasObjectId,
  ): notification is IInAppNotification<IUser> & HasObjectId => {
    return notification.targetModel === SupportedTargetModel.MODEL_USER;
  };

  if (!isUserModelNotification(notification)) {
    return null;
  }

  const actionUsers = notification.target.username;

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
    router.push('/admin/users');
  };

  return {
    Notification,
    publishOpen,
  };
};
