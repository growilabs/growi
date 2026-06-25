import { type JSX, Suspense, useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslation } from 'react-i18next';

import ItemsTreeContentSkeleton from '../../ItemsTree/ItemsTreeContentSkeleton';
import { useMergedInAppNotifications } from './hooks/useMergedInAppNotifications';
import { InAppNotificationForms } from './InAppNotificationForms';
import type { FilterType } from './types';

const InAppNotificationContent = dynamic(
  () =>
    import('./InAppNotificationContent').then(
      (mod) => mod.InAppNotificationContent,
    ),
  { ssr: false },
);

export const InAppNotification = (): JSX.Element => {
  const { t } = useTranslation();

  const [isUnopendNotificationsVisible, setUnopendNotificationsVisible] =
    useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  const merged = useMergedInAppNotifications(isUnopendNotificationsVisible);
  const { newsUnreadCount, notifUnreadCount, handleMarkAllRead } = merged;

  const isMarkAllReadDisabled = useMemo(() => {
    const newsHas = (newsUnreadCount ?? 0) > 0;
    const notifHas = (notifUnreadCount ?? 0) > 0;
    if (activeFilter === 'news') return !newsHas;
    if (activeFilter === 'notifications') return !notifHas;
    return !newsHas && !notifHas;
  }, [activeFilter, newsUnreadCount, notifUnreadCount]);

  const onMarkAllRead = useCallback(() => {
    void handleMarkAllRead({
      news: activeFilter !== 'notifications',
      notifications: activeFilter !== 'news',
    });
  }, [activeFilter, handleMarkAllRead]);

  return (
    <div className="px-3">
      <div className="grw-sidebar-content-header py-4 d-flex">
        <h3 className="fs-6 fw-bold mb-0">{t('In-App Notification')}</h3>
      </div>

      <InAppNotificationForms
        isUnopendNotificationsVisible={isUnopendNotificationsVisible}
        onChangeUnopendNotificationsVisible={() => {
          setUnopendNotificationsVisible(!isUnopendNotificationsVisible);
        }}
        activeFilter={activeFilter}
        onChangeFilter={setActiveFilter}
        onMarkAllRead={onMarkAllRead}
        isMarkAllReadDisabled={isMarkAllReadDisabled}
      />

      <Suspense fallback={<ItemsTreeContentSkeleton />}>
        <InAppNotificationContent activeFilter={activeFilter} merged={merged} />
      </Suspense>
    </div>
  );
};
