import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';

import InAppNotificationElm from '~/client/components/InAppNotification/InAppNotificationElm';
import InfiniteScroll from '~/client/components/InfiniteScroll';
import { NewsItem } from '~/features/news/client/components/NewsItem';
import { useSidebarMode } from '~/states/ui/sidebar';

import { useMergedInAppNotifications } from './hooks/useMergedInAppNotifications';
import type { FilterType } from './InAppNotification';

type InAppNotificationContentProps = {
  isUnopendNotificationsVisible: boolean;
  activeFilter: FilterType;
};

export const InAppNotificationContent = (
  props: InAppNotificationContentProps,
): JSX.Element => {
  const { isUnopendNotificationsVisible, activeFilter } = props;
  const { t } = useTranslation('commons');
  const { isCollapsedMode } = useSidebarMode();

  // In collapsed mode (hover panel): constrain height + own scrollbar.
  // In dock/drawer mode: no constraints — outer SimpleBar handles all scrolling.
  const collapsed = isCollapsedMode();
  const scrollAreaClassName = collapsed ? 'overflow-auto' : undefined;
  const scrollAreaStyle = collapsed ? { maxHeight: '60vh' } : undefined;

  const {
    newsResponse,
    allNewsItems,
    newsExhausted,
    notificationResponse,
    allNotificationItems,
    notifExhausted,
    allModeSWRResponse,
    mergedItems,
    handleReadMutate,
    handleNotificationRead,
  } = useMergedInAppNotifications(isUnopendNotificationsVisible);

  if (activeFilter === 'news') {
    if (allNewsItems.length === 0 && !newsResponse.isValidating) {
      return <>{t('in_app_notification.no_news')}</>;
    }

    return (
      <div className={scrollAreaClassName} style={scrollAreaStyle}>
        <InfiniteScroll
          swrInifiniteResponse={newsResponse}
          isReachingEnd={newsExhausted}
        >
          <div className="list-group">
            {allNewsItems.map((item) => (
              <NewsItem
                key={item._id.toString()}
                item={item}
                onReadMutate={handleReadMutate}
              />
            ))}
          </div>
        </InfiniteScroll>
      </div>
    );
  }

  if (activeFilter === 'notifications') {
    if (
      allNotificationItems.length === 0 &&
      !notificationResponse.isValidating
    ) {
      return <>{t('in_app_notification.no_notification')}</>;
    }

    return (
      <div className={scrollAreaClassName} style={scrollAreaStyle}>
        <InfiniteScroll
          swrInifiniteResponse={notificationResponse}
          isReachingEnd={notifExhausted}
        >
          <div className="list-group">
            {allNotificationItems.map((notification) => {
              const id = notification._id.toString();
              return (
                <InAppNotificationElm
                  key={id}
                  notification={notification}
                  onUnopenedNotificationOpend={() => handleNotificationRead(id)}
                />
              );
            })}
          </div>
        </InfiniteScroll>
      </div>
    );
  }

  // 'all' filter: merged view
  if (
    mergedItems.length === 0 &&
    !newsResponse.isValidating &&
    !notificationResponse.isValidating
  ) {
    return <>{t('in_app_notification.no_notification')}</>;
  }

  return (
    <div className={scrollAreaClassName} style={scrollAreaStyle}>
      <InfiniteScroll
        swrInifiniteResponse={allModeSWRResponse}
        isReachingEnd={newsExhausted && notifExhausted}
      >
        <div className="list-group">
          {mergedItems.map((entry) => {
            if (entry.type === 'news') {
              return (
                <NewsItem
                  key={`news-${entry.item._id.toString()}`}
                  item={entry.item}
                  onReadMutate={handleReadMutate}
                />
              );
            }
            const id = entry.item._id.toString();
            return (
              <InAppNotificationElm
                key={`notif-${id}`}
                notification={entry.item}
                onUnopenedNotificationOpend={() => handleNotificationRead(id)}
              />
            );
          })}
        </div>
      </InfiniteScroll>
    </div>
  );
};
