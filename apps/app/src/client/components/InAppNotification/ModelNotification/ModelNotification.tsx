import type { FC, JSX } from 'react';
import React from 'react';
import type { HasObjectId } from '@growi/core';
import { PagePathLabel } from '@growi/ui/dist/components';

import type { IInAppNotification } from '~/interfaces/in-app-notification';

import FormattedDistanceDate from '../../FormattedDistanceDate';

import styles from './ModelNotification.module.scss';

type Props = {
  notification: IInAppNotification & HasObjectId;
  actionMsg: string;
  actionIcon: string;
  actionUsers: string;
  hideActionUsers?: boolean;
  hidePath?: boolean;
  subMsg?: JSX.Element;
};

export const ModelNotification: FC<Props> = ({
  notification,
  actionMsg,
  actionIcon,
  actionUsers,
  hideActionUsers = false,
  hidePath = false,
  subMsg,
}: Props) => {
  return (
    <div className={`${styles['modal-notification']} p-2 overflow-hidden`}>
      <div className="text-truncate page-title">
        {hideActionUsers ? <></> : <b>{actionUsers}</b>}
        {` ${actionMsg}`}
        {!hidePath && (
          <PagePathLabel path={notification.parsedSnapshot?.path ?? ''} />
        )}
      </div>
      {subMsg}
      <span className="material-symbols-outlined me-2">{actionIcon}</span>
      <FormattedDistanceDate
        id={notification._id}
        date={notification.createdAt}
        isShowTooltip={false}
        differenceForAvoidingFormat={Number.POSITIVE_INFINITY}
      />
    </div>
  );
};
