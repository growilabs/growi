import React, { useCallback } from 'react';
import { useRouter } from 'next/router';
import type { HasObjectId, IPage } from '@growi/core';

import { SupportedTargetModel } from '~/interfaces/activity';
import type { IInAppNotification } from '~/interfaces/in-app-notification';
import * as pageSerializers from '~/models/serializers/in-app-notification-snapshot/page';

import type { ModelNotificationUtils } from '.';
import { ModelNotification } from './ModelNotification';
import { useActionMsgAndIconForModelNotification } from './useActionAndMsg';

export const usePageModelNotification = (
  notification: IInAppNotification & HasObjectId,
): ModelNotificationUtils | null => {
  const router = useRouter();
  const { actionMsg, actionIcon } =
    useActionMsgAndIconForModelNotification(notification);

  const getActionUsers = useCallback(() => {
    // actionUsers can contain null when the linked activity has no user:
    // chiefly an activity settled without its request context (bare
    // activity, mostly from editor saves), or one that references a
    // since-removed user. Drop nulls before reading `.name`, otherwise a
    // single null crashes the whole notification list (and, via the error
    // boundary, the entire page).
    const actionUsers = notification.actionUsers.filter((user) => user != null);
    const latestActionUsers = actionUsers.slice(0, 3);
    const latestUsers = latestActionUsers.map((user) => {
      return `@${user.name}`;
    });

    let actionedUsers = '';
    const latestUsersCount = latestUsers.length;
    if (latestUsersCount === 1) {
      actionedUsers = latestUsers[0];
    } else if (actionUsers.length >= 4) {
      actionedUsers = `${latestUsers.slice(0, 2).join(', ')} and ${actionUsers.length - 2} others`;
    } else {
      actionedUsers = latestUsers.join(', ');
    }

    return actionedUsers;
  }, [notification.actionUsers]);

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
