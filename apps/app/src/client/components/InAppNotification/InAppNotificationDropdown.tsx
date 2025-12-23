import React, {
  useState, useEffect, useRef, type JSX,
} from 'react';

import { useTranslation } from 'next-i18next';
import { useRipple } from 'react-use-ripple';
import {
  Dropdown, DropdownToggle, DropdownMenu, DropdownItem,
} from 'reactstrap';

import { useGlobalSocket } from '~/states/socket-io';
import { useSWRxInAppNotifications, useSWRxInAppNotificationStatus } from '~/stores/in-app-notification';

import InAppNotificationList from './InAppNotificationList';

export const InAppNotificationDropdown = (): JSX.Element => {
  const { t } = useTranslation('commons');

  const [isOpen, setIsOpen] = useState(false);
  const limit = 6;

  const socket = useGlobalSocket();
  const { data: inAppNotificationData, mutate: mutateInAppNotificationData } = useSWRxInAppNotifications(
    limit, undefined, undefined,
    { revalidateOnFocus: isOpen },
  );
  const { data: inAppNotificationUnreadStatusCount, mutate: mutateInAppNotificationUnreadStatusCount } = useSWRxInAppNotificationStatus();

  // ripple
  const buttonRef = useRef(null);
  useRipple(buttonRef, { rippleColor: 'rgba(255, 255, 255, 0.3)' });

  useEffect(() => {
    if (socket != null) {
      socket.on('notificationUpdated', () => {
        mutateInAppNotificationUnreadStatusCount();
      });

      // clean up
      return () => {
        socket.off('notificationUpdated');
      };
    }
  }, [mutateInAppNotificationUnreadStatusCount, socket]);


  const toggleDropdownHandler = async() => {
    if (!isOpen && inAppNotificationUnreadStatusCount != null && inAppNotificationUnreadStatusCount > 0) {
      mutateInAppNotificationUnreadStatusCount();
    }

    const newIsOpenState = !isOpen;
    if (newIsOpenState) {
      mutateInAppNotificationData();
    }
    setIsOpen(newIsOpenState);
  };

  let badge;
  if (inAppNotificationUnreadStatusCount != null && inAppNotificationUnreadStatusCount > 0) {
    badge = <span className="badge rounded-pill bg-danger grw-notification-badge">{inAppNotificationUnreadStatusCount}</span>;
  }
  else {
    badge = '';
  }

  return (
    <Dropdown className="notification-wrapper grw-notification-dropdown" isOpen={isOpen} toggle={toggleDropdownHandler} direction="end">
      <DropdownToggle className="px-3" color="primary" innerRef={buttonRef}>
        <span className="material-symbols-outlined">notifications</span> {badge}
      </DropdownToggle>

      { isOpen && (
        <DropdownMenu end>
          { inAppNotificationData != null && inAppNotificationData.docs.length === 0
          // no items
            ? <DropdownItem disabled>{t('in_app_notification.no_unread_messages')}</DropdownItem>
          // render DropdownItem
            : <InAppNotificationList inAppNotificationData={inAppNotificationData} />
          }
          <DropdownItem divider />
          <DropdownItem tag="a" href="/me/all-in-app-notifications">
            { t('in_app_notification.see_all') }
          </DropdownItem>
        </DropdownMenu>
      ) }
    </Dropdown>
  );
};
