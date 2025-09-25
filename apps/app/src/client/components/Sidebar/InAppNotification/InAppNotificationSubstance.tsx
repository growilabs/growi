import React, { type JSX } from 'react';

import { useTranslation } from 'next-i18next';

import InAppNotificationList from '~/client/components/InAppNotification/InAppNotificationList';
import { InAppNotificationStatuses } from '~/interfaces/in-app-notification';
import { useSWRxInAppNotifications } from '~/stores/in-app-notification';


type InAppNotificationFormsProps = {
  onChangeUnopendNotificationsVisible: () => void
}
export const InAppNotificationForms = (props: InAppNotificationFormsProps): JSX.Element => {
  const { onChangeUnopendNotificationsVisible } = props;
  const { t } = useTranslation('commons');

  return (
    <div className="my-2">
      <div className="form-check form-switch">
        <label className="form-check-label" htmlFor="flexSwitchCheckDefault">{t('in_app_notification.only_unread')}</label>
        <input
          id="flexSwitchCheckDefault"
          className="form-check-input"
          type="checkbox"
          role="switch"
          onChange={onChangeUnopendNotificationsVisible}
        />
      </div>
    </div>
  );
};


type InAppNotificationContentProps = {
  isUnopendNotificationsVisible: boolean
}
export const InAppNotificationContent = (props: InAppNotificationContentProps): JSX.Element => {
  const { isUnopendNotificationsVisible } = props;
  const { t } = useTranslation('commons');

  // TODO: Infinite scroll implemented (https://redmine.weseek.co.jp/issues/138057)
  const { data: inAppNotificationData, mutate: mutateInAppNotificationData } = useSWRxInAppNotifications(
    6,
    undefined,
    isUnopendNotificationsVisible ? InAppNotificationStatuses.STATUS_UNOPENED : undefined,
    { keepPreviousData: true },
  );

  return (
    <>
      {inAppNotificationData != null && inAppNotificationData.docs.length === 0
      // no items
        ? t('in_app_notification.no_notification')
      // render list-group
        : (
          <InAppNotificationList
            inAppNotificationData={inAppNotificationData}
            onUnopenedNotificationOpend={mutateInAppNotificationData}
          />
        )
      }
    </>
  );
};
