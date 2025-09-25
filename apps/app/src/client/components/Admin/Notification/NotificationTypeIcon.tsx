import React, { type JSX } from 'react';

import { UncontrolledTooltip } from 'reactstrap';

import type { INotificationType } from '~/client/interfaces/notification';


type NotificationTypeIconProps = {
  // supports 2 types:
  //   User trigger notification -> has 'provider: slack'
  //   Global notification -> has '__t: slack|mail'
  notification: INotificationType
}

export const NotificationTypeIcon = (props: NotificationTypeIconProps): JSX.Element => {
  const { __t, _id, provider } = props.notification;

  const type = __t != null && __t === 'mail' ? 'mail' : 'slack';

  // User trigger notification
  if (provider != null) {
    // only slack type
  }

  const elemId = `notification-${type}-${_id}`;
  const iconName = type === 'mail' ? 'mail' : 'tag';
  const toolChip = type === 'mail' ? 'Mail' : 'Slack';

  return (
    <>
      <span id={elemId} className="material-symbols-outlined me-1">{iconName}</span>
      <UncontrolledTooltip target={elemId}>{toolChip}</UncontrolledTooltip>
    </>
  );
};
