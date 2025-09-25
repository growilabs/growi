import type { FC, JSX } from 'react';
import React from 'react';

import type { HasObjectId } from '@growi/core';
import { UserPicture } from '@growi/ui/dist/components';

import { apiv3Post } from '~/client/util/apiv3-client';
import type { IInAppNotification } from '~/interfaces/in-app-notification';
import { InAppNotificationStatuses } from '~/interfaces/in-app-notification';
import { useSWRxInAppNotificationStatus } from '~/stores/in-app-notification';

import { useModelNotification } from './ModelNotification';

interface Props {
  notification: IInAppNotification & HasObjectId
  onUnopenedNotificationOpend?: () => void,
}

const InAppNotificationElm: FC<Props> = (props: Props) => {

  const { notification, onUnopenedNotificationOpend } = props;

  const modelNotificationUtils = useModelNotification(notification);

  const Notification = modelNotificationUtils?.Notification;
  const publishOpen = modelNotificationUtils?.publishOpen;
  const clickLink = modelNotificationUtils?.clickLink;
  const isDisabled = modelNotificationUtils?.isDisabled;
  const { mutate: mutateNotificationCount } = useSWRxInAppNotificationStatus();

  if (Notification == null) {
    return <></>;
  }

  const clickHandler = async(notification: IInAppNotification & HasObjectId): Promise<void> => {
    if (notification.status === InAppNotificationStatuses.STATUS_UNOPENED) {
      // set notification status "OPEND"
      await apiv3Post('/in-app-notification/open', { id: notification._id });
      onUnopenedNotificationOpend?.();
      mutateNotificationCount();
    }

    if (isDisabled) return;

    publishOpen?.();
  };

  const renderActionUserPictures = (): JSX.Element => {
    const actionUsers = notification.actionUsers;

    if (actionUsers.length < 1) {
      return <></>;
    }
    if (actionUsers.length === 1) {
      return <UserPicture user={actionUsers[0]} size="md" noTooltip />;
    }
    return (
      <div className="position-relative">
        <UserPicture user={actionUsers[0]} size="md" noTooltip />
        <div className="position-absolute" style={{ top: 10, left: 10 }}>
          <UserPicture user={actionUsers[1]} size="md" noTooltip />
        </div>
      </div>
    );
  };

  return (
    <div className="list-group-item list-group-item-action" style={{ cursor: 'pointer' }}>
      <a
        href={isDisabled ? undefined : clickLink}
        onClick={() => clickHandler(notification)}
      >
        <div className="d-flex align-items-center">
          <span
            className={`${notification.status === InAppNotificationStatuses.STATUS_UNOPENED
              ? 'grw-unopend-notification'
              : 'ms-2'
            } rounded-circle me-3`}
          >
          </span>

          {renderActionUserPictures()}

          <Notification />

        </div>
      </a>
    </div>
  );
};

export default InAppNotificationElm;
