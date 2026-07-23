import type { JSX } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'next-i18next';

import InAppNotificationElm from '~/client/components/InAppNotification/InAppNotificationElm';
import InfiniteScroll from '~/client/components/InfiniteScroll';
import { NewsItem } from '~/features/news/client/components/NewsItem';
import { useSidebarMode } from '~/states/ui/sidebar';

import type { UseMergedInAppNotificationsResult } from './hooks/useMergedInAppNotifications';
import type { FilterType } from './types';

type InAppNotificationContentProps = {
  activeFilter: FilterType;
  merged: UseMergedInAppNotificationsResult;
  /**
   * Whether the unread-only toggle is active. Needed here because the
   * news-id → page-index mapping is only valid against the unfiltered feed
   * (see newsPageIndexById below).
   */
  isUnopendNotificationsVisible: boolean;
};

export const InAppNotificationContent = (
  props: InAppNotificationContentProps,
): JSX.Element => {
  const { activeFilter, merged, isUnopendNotificationsVisible } = props;
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
    handleNewsRead,
    handleNotificationRead,
  } = merged;

  // Map each news item id to its SWRInfinite page index. This lets NewsItem
  // navigate directly to `/_news?page=N#news-<id>` without walking pages.
  // Under the unread-only filter the sidebar stream is a different (filtered)
  // sequence, so its page boundaries do not match the full /_news feed — no
  // valid mapping exists. Leave the map empty so NewsItem receives
  // `pageIndex: undefined` and navigates without a `?page` query.
  const newsPageIndexById = useMemo(() => {
    const map = new Map<string, number>();
    if (isUnopendNotificationsVisible) return map;
    newsResponse.data?.forEach((page, pageIdx) => {
      for (const item of page.docs) {
        map.set(item._id.toString(), pageIdx);
      }
    });
    return map;
  }, [newsResponse.data, isUnopendNotificationsVisible]);

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
                pageIndex={newsPageIndexById.get(item._id.toString())}
                onReadMutate={handleNewsRead}
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
              const newsId = entry.item._id.toString();
              return (
                <NewsItem
                  key={`news-${newsId}`}
                  item={entry.item}
                  pageIndex={newsPageIndexById.get(newsId)}
                  onReadMutate={handleNewsRead}
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
