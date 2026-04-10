import { type JSX, useId, useMemo, useState } from 'react';
import type { HasObjectId } from '@growi/core';
import { useTranslation } from 'next-i18next';

import InAppNotificationElm from '~/client/components/InAppNotification/InAppNotificationElm';
import InfiniteScroll from '~/client/components/InfiniteScroll';
import { NewsItem } from '~/features/news/client/components/NewsItem';
import {
  useSWRINFxNews,
  useSWRxNewsUnreadCount,
} from '~/features/news/client/hooks/use-news';
import type { INewsItemWithReadStatus } from '~/features/news/interfaces/news-item';
import type { IInAppNotification } from '~/interfaces/in-app-notification';
import { InAppNotificationStatuses } from '~/interfaces/in-app-notification';
import { useSidebarMode } from '~/states/ui/sidebar';
import { useSWRINFxInAppNotifications } from '~/stores/in-app-notification';

import type { FilterType } from './InAppNotification';

const NEWS_PER_PAGE = 10;

type InAppNotificationFormsProps = {
  isUnopendNotificationsVisible: boolean;
  onChangeUnopendNotificationsVisible: () => void;
  activeFilter: FilterType;
  onChangeFilter: (filter: FilterType) => void;
};

export const InAppNotificationForms = (
  props: InAppNotificationFormsProps,
): JSX.Element => {
  const {
    isUnopendNotificationsVisible,
    onChangeUnopendNotificationsVisible,
    activeFilter,
    onChangeFilter,
  } = props;
  const { t } = useTranslation('commons');
  const toggleId = useId();

  return (
    <div className="my-2">
      {/* Filter tabs */}
      <fieldset className="btn-group w-100 mb-2">
        <button
          type="button"
          className={`btn btn-sm ${activeFilter === 'all' ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => onChangeFilter('all')}
        >
          {t('in_app_notification.filter_all')}
        </button>
        <button
          type="button"
          className={`btn btn-sm ${activeFilter === 'notifications' ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => onChangeFilter('notifications')}
        >
          {t('in_app_notification.notifications')}
        </button>
        <button
          type="button"
          className={`btn btn-sm ${activeFilter === 'news' ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => onChangeFilter('news')}
        >
          {t('in_app_notification.news')}
        </button>
      </fieldset>

      {/* Unread-only toggle */}
      <div className="form-check form-switch">
        <label className="form-check-label" htmlFor={toggleId}>
          {t('in_app_notification.only_unread')}
        </label>
        <input
          id={toggleId}
          className="form-check-input"
          type="checkbox"
          role="switch"
          aria-checked={isUnopendNotificationsVisible}
          checked={isUnopendNotificationsVisible}
          onChange={onChangeUnopendNotificationsVisible}
        />
      </div>
    </div>
  );
};

type InAppNotificationContentProps = {
  isUnopendNotificationsVisible: boolean;
  activeFilter: FilterType;
};

type MergedItem =
  | { type: 'news'; item: INewsItemWithReadStatus; sortKey: Date }
  | {
      type: 'notification';
      item: IInAppNotification & HasObjectId;
      sortKey: Date;
    };

export const InAppNotificationContent = (
  props: InAppNotificationContentProps,
): JSX.Element => {
  const { isUnopendNotificationsVisible, activeFilter } = props;
  const { t } = useTranslation('commons');
  const { isCollapsedMode } = useSidebarMode();

  // Track locally-opened notifications to give instant dot removal without
  // relying on SWR cache persistence across navigation/unmount cycles.
  const [locallyOpenedNotifIds, setLocallyOpenedNotifIds] = useState<
    Set<string>
  >(new Set());

  // In collapsed mode (hover panel): constrain height + own scrollbar
  // In dock/drawer mode: no constraints — outer SimpleBar handles all scrolling
  const collapsed = isCollapsedMode();
  const scrollAreaClassName = collapsed ? 'overflow-auto' : undefined;
  const scrollAreaStyle = collapsed ? { maxHeight: '60vh' } : undefined;

  const notificationStatus = isUnopendNotificationsVisible
    ? InAppNotificationStatuses.STATUS_UNOPENED
    : undefined;

  // Always call both hooks (React rules of hooks)
  const newsResponse = useSWRINFxNews(
    NEWS_PER_PAGE,
    { onlyUnread: isUnopendNotificationsVisible },
    { keepPreviousData: true },
  );
  const { mutate: mutateNewsUnreadCount } = useSWRxNewsUnreadCount();

  const notificationResponse = useSWRINFxInAppNotifications(
    NEWS_PER_PAGE,
    { status: notificationStatus },
    { keepPreviousData: true },
  );

  const allNewsItems: INewsItemWithReadStatus[] = useMemo(() => {
    if (!newsResponse.data) return [];
    return newsResponse.data.flatMap((page) => page.docs);
  }, [newsResponse.data]);

  const allNotificationItems: (IInAppNotification & HasObjectId)[] =
    useMemo(() => {
      if (!notificationResponse.data) return [];
      return notificationResponse.data.flatMap(
        (page) => page.docs,
      ) as (IInAppNotification & HasObjectId)[];
    }, [notificationResponse.data]);

  // Determine if each stream has exhausted its pages
  const newsExhausted = useMemo(
    () =>
      newsResponse.data != null &&
      newsResponse.data.length > 0 &&
      !newsResponse.data[newsResponse.data.length - 1].hasNextPage,
    [newsResponse.data],
  );

  const notifExhausted = useMemo(
    () =>
      notificationResponse.data != null &&
      notificationResponse.data.length > 0 &&
      !notificationResponse.data[notificationResponse.data.length - 1]
        .hasNextPage,
    [notificationResponse.data],
  );

  // Synthetic SWRInfiniteResponse for InfiniteScroll in 'all' mode
  const allModeSWRResponse = useMemo(
    () => ({
      data: newsResponse.data,
      error: newsResponse.error ?? notificationResponse.error,
      isValidating:
        newsResponse.isValidating || notificationResponse.isValidating,
      isLoading: newsResponse.isLoading || notificationResponse.isLoading,
      mutate: newsResponse.mutate,
      setSize: (updater: number | ((size: number) => number)) => {
        const promises: Promise<unknown>[] = [];
        if (!newsExhausted) {
          promises.push(
            newsResponse.setSize(
              typeof updater === 'function'
                ? updater(newsResponse.size)
                : updater,
            ),
          );
        }
        if (!notifExhausted) {
          promises.push(
            notificationResponse.setSize(
              typeof updater === 'function'
                ? updater(notificationResponse.size)
                : updater,
            ),
          );
        }
        return Promise.all(promises) as unknown as Promise<
          (typeof newsResponse.data)[]
        >;
      },
      size: Math.max(newsResponse.size, notificationResponse.size),
    }),
    [newsResponse, notificationResponse, newsExhausted, notifExhausted],
  );

  // Merged and sorted items for 'all' filter
  const mergedItems: MergedItem[] = useMemo(() => {
    const newsEntries: MergedItem[] = allNewsItems.map((item) => ({
      type: 'news',
      item,
      sortKey:
        item.publishedAt instanceof Date
          ? item.publishedAt
          : new Date(item.publishedAt),
    }));
    const notifEntries: MergedItem[] = allNotificationItems.map((item) => ({
      type: 'notification',
      item,
      sortKey:
        item.createdAt instanceof Date
          ? item.createdAt
          : new Date(item.createdAt),
    }));
    return [...newsEntries, ...notifEntries].sort(
      (a, b) => b.sortKey.getTime() - a.sortKey.getTime(),
    );
  }, [allNewsItems, allNotificationItems]);

  const handleReadMutate = () => {
    newsResponse.mutate();
    mutateNewsUnreadCount();
  };

  // Use local state to immediately remove the unread dot on click.
  // Relying solely on SWR mutate is unreliable because useSWRInfinite per-page
  // caches can be stale after navigation/unmount, so the dot reappears on
  // remount even with revalidate:false.
  const handleNotificationRead = (notificationId: string) => {
    setLocallyOpenedNotifIds((prev) => new Set(prev).add(notificationId));
  };

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
                  notification={
                    locallyOpenedNotifIds.has(id)
                      ? {
                          ...notification,
                          status: InAppNotificationStatuses.STATUS_OPENED,
                        }
                      : notification
                  }
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
        swrInifiniteResponse={
          allModeSWRResponse as unknown as Parameters<
            typeof InfiniteScroll
          >[0]['swrInifiniteResponse']
        }
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
                notification={
                  locallyOpenedNotifIds.has(id)
                    ? {
                        ...entry.item,
                        status: InAppNotificationStatuses.STATUS_OPENED,
                      }
                    : entry.item
                }
                onUnopenedNotificationOpend={() => handleNotificationRead(id)}
              />
            );
          })}
        </div>
      </InfiniteScroll>
    </div>
  );
};
