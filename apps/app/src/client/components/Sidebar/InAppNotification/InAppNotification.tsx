import { type JSX, Suspense, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslation } from 'react-i18next';

import ItemsTreeContentSkeleton from '../../ItemsTree/ItemsTreeContentSkeleton';
import { InAppNotificationForms } from './InAppNotificationSubstance';

export type FilterType = 'all' | 'news' | 'notifications';

const InAppNotificationContent = dynamic(
  () =>
    import('./InAppNotificationSubstance').then(
      (mod) => mod.InAppNotificationContent,
    ),
  { ssr: false },
);

export const InAppNotification = (): JSX.Element => {
  const { t } = useTranslation();

  const [isUnopendNotificationsVisible, setUnopendNotificationsVisible] =
    useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

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
      />

      <Suspense fallback={<ItemsTreeContentSkeleton />}>
        <InAppNotificationContent
          isUnopendNotificationsVisible={isUnopendNotificationsVisible}
          activeFilter={activeFilter}
        />
      </Suspense>
    </div>
  );
};
