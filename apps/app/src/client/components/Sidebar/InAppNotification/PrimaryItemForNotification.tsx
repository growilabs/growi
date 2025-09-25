import { memo, useCallback, useEffect } from 'react';

import { SidebarContentsType } from '~/interfaces/ui';
import { useSWRxInAppNotificationStatus } from '~/stores/in-app-notification';
import { useDefaultSocket } from '~/stores/socket-io';

import { PrimaryItem, type PrimaryItemProps } from '../SidebarNav/PrimaryItem';

type PrimaryItemForNotificationProps = Omit<PrimaryItemProps, 'onClick' | 'label' | 'iconName' | 'contents' | 'badgeContents' >

export const PrimaryItemForNotification = memo((props: PrimaryItemForNotificationProps) => {
  const { sidebarMode, onHover } = props;

  const { data: socket } = useDefaultSocket();

  const { data: notificationCount, mutate: mutateNotificationCount } = useSWRxInAppNotificationStatus();

  const badgeContents = notificationCount != null && notificationCount > 0 ? notificationCount : undefined;

  const itemHoverHandler = useCallback((contents: SidebarContentsType) => {
    onHover?.(contents);
  }, [onHover]);

  useEffect(() => {
    if (socket != null) {
      socket.on('notificationUpdated', () => {
        mutateNotificationCount();
      });

      // clean up
      return () => {
        socket.off('notificationUpdated');
      };
    }
  }, [mutateNotificationCount, socket]);

  return (
    <PrimaryItem
      sidebarMode={sidebarMode}
      contents={SidebarContentsType.NOTIFICATION}
      label="In-App Notification"
      iconName="notifications"
      badgeContents={badgeContents}
      onHover={itemHoverHandler}
    />
  );
});
