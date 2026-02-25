import type { FC } from 'react';
import React, { useState } from 'react';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';

import { apiv3Put } from '~/client/util/apiv3-client';
import { InAppNotificationStatuses } from '~/interfaces/in-app-notification';
import { showPageLimitationXLAtom } from '~/states/server-configurations';
import {
  useSWRxInAppNotificationStatus,
  useSWRxInAppNotifications,
} from '~/stores/in-app-notification';

import CustomNavAndContents from '../CustomNavigation/CustomNavAndContents';
import PaginationWrapper from '../PaginationWrapper';
import InAppNotificationList from './InAppNotificationList';

type InAppNotificationCategoryByStatusProps = {
  status?: InAppNotificationStatuses;
};

const EmptyIcon: FC = () => {
  return null;
};

const InAppNotificationCategoryByStatus: FC<
  InAppNotificationCategoryByStatusProps
> = ({ status }) => {
  const { t } = useTranslation('commons');

  const showPageLimitationXL = useAtomValue(showPageLimitationXLAtom);
  const limit = showPageLimitationXL != null ? showPageLimitationXL : 20;

  const [activePage, setActivePage] = useState(1);
  const offset = (activePage - 1) * limit;

  const categoryStatus =
    status === InAppNotificationStatuses.STATUS_UNOPENED
      ? InAppNotificationStatuses.STATUS_UNOPENED
      : undefined;

  const { data: notificationData, mutate: mutateNotificationData } =
    useSWRxInAppNotifications(limit, offset, categoryStatus);
  const { mutate: mutateAllNotificationData } = useSWRxInAppNotifications(
    limit,
    offset,
    undefined,
  );
  const { mutate: mutateNotificationCount } = useSWRxInAppNotificationStatus();

  const setAllNotificationPageNumber = (selectedPageNumber: number): void => {
    setActivePage(selectedPageNumber);
  };

  if (notificationData == null) {
    return (
      <div className="wiki" data-testid="grw-in-app-notification-page-spinner">
        <div className="text-muted text-center">
          <LoadingSpinner className="me-1 fs-3" />
        </div>
      </div>
    );
  }

  const updateUnopendNotificationStatusesToOpened = async () => {
    await apiv3Put('/in-app-notification/all-statuses-open');
    // mutate notification statuses in 'UNREAD' Category
    mutateNotificationData();
    // mutate notification statuses in 'ALL' Category
    mutateAllNotificationData();
    mutateNotificationCount();
  };

  return (
    <>
      {status === InAppNotificationStatuses.STATUS_UNOPENED &&
        notificationData.totalDocs > 0 && (
          <div className="mb-2 d-flex justify-content-end">
            <button
              type="button"
              className="btn btn-outline-primary"
              onClick={updateUnopendNotificationStatusesToOpened}
            >
              {t('in_app_notification.mark_all_as_read')}
            </button>
          </div>
        )}
      {notificationData != null && notificationData.docs.length === 0 ? (
        // no items
        t('in_app_notification.no_unread_messages')
      ) : (
        // render list-group
        <InAppNotificationList inAppNotificationData={notificationData} />
      )}

      {notificationData.totalDocs > 0 && (
        <div className="mt-4">
          <PaginationWrapper
            activePage={activePage}
            changePage={setAllNotificationPageNumber}
            totalItemsCount={notificationData.totalDocs}
            pagingLimit={notificationData.limit}
            align="center"
            size="sm"
          />
        </div>
      )}
    </>
  );
};

const InAppNotificationAllTabContent: FC = () => {
  return <InAppNotificationCategoryByStatus />;
};

const InAppNotificationUnreadTabContent: FC = () => {
  return (
    <InAppNotificationCategoryByStatus
      status={InAppNotificationStatuses.STATUS_UNOPENED}
    />
  );
};

export const InAppNotificationPage: FC = () => {
  const { t } = useTranslation('commons');

  const navTabMapping = {
    user_infomation: {
      Icon: EmptyIcon,
      Content: InAppNotificationAllTabContent,
      i18n: t('in_app_notification.all'),
    },
    external_accounts: {
      Icon: EmptyIcon,
      Content: InAppNotificationUnreadTabContent,
      i18n: t('in_app_notification.unopend'),
    },
  };

  return (
    <div data-testid="grw-in-app-notification-page">
      <CustomNavAndContents
        navTabMapping={navTabMapping}
        tabContentClasses={['mt-4']}
      />
    </div>
  );
};

InAppNotificationPage.displayName = 'InAppNotificationPage';
