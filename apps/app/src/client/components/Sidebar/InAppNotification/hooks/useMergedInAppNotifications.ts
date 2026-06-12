import { useCallback, useMemo } from 'react';
import type { SWRInfiniteResponse } from 'swr/infinite';

import {
  useSWRINFxNews,
  useSWRxNewsUnreadCount,
} from '~/features/news/client/hooks/use-news';
import type { INewsItemWithReadStatus } from '~/features/news/interfaces/news-item';
import type {
  IInAppNotificationHasId,
  PaginateResult,
} from '~/interfaces/in-app-notification';
import { InAppNotificationStatuses } from '~/interfaces/in-app-notification';
import { useSWRINFxInAppNotifications } from '~/stores/in-app-notification';

const PER_PAGE = 10;

export type MergedItem =
  | { type: 'news'; item: INewsItemWithReadStatus; sortKey: Date }
  | { type: 'notification'; item: IInAppNotificationHasId; sortKey: Date };

export type UseMergedInAppNotificationsResult = {
  newsResponse: SWRInfiniteResponse<
    PaginateResult<INewsItemWithReadStatus>,
    Error
  >;
  allNewsItems: INewsItemWithReadStatus[];
  newsExhausted: boolean;

  notificationResponse: SWRInfiniteResponse<
    PaginateResult<IInAppNotificationHasId>,
    Error
  >;
  allNotificationItems: IInAppNotificationHasId[];
  notifExhausted: boolean;

  allModeSWRResponse: SWRInfiniteResponse<
    PaginateResult<INewsItemWithReadStatus>,
    Error
  >;
  mergedItems: MergedItem[];

  handleReadMutate: () => void;
  handleNotificationRead: (notificationId: string) => void;
};

/**
 * Encapsulates the data layer for the InAppNotification sidebar panel:
 * - Two SWRInfinite streams (news + notifications)
 * - Pagination exhaustion detection
 * - A synthetic SWRInfiniteResponse for the merged "all" view
 * - Client-side merge + sort by time
 * - Read-state mutation handlers (SWR-native optimistic update)
 */
export const useMergedInAppNotifications = (
  isUnopendNotificationsVisible: boolean,
): UseMergedInAppNotificationsResult => {
  const notificationStatus = isUnopendNotificationsVisible
    ? InAppNotificationStatuses.STATUS_UNOPENED
    : undefined;

  const newsResponse = useSWRINFxNews(
    PER_PAGE,
    { onlyUnread: isUnopendNotificationsVisible },
    { keepPreviousData: true },
  );
  const { mutate: mutateNewsUnreadCount } = useSWRxNewsUnreadCount();

  const notificationResponse = useSWRINFxInAppNotifications(
    PER_PAGE,
    { status: notificationStatus },
    { keepPreviousData: true },
  );

  const allNewsItems: INewsItemWithReadStatus[] = useMemo(() => {
    if (!newsResponse.data) return [];
    return newsResponse.data.flatMap((page) => page.docs);
  }, [newsResponse.data]);

  const allNotificationItems: IInAppNotificationHasId[] = useMemo(() => {
    if (!notificationResponse.data) return [];
    return notificationResponse.data.flatMap((page) => page.docs);
  }, [notificationResponse.data]);

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

  // Synthetic SWRInfiniteResponse for InfiniteScroll in 'all' mode.
  // Typed to match newsResponse's shape so InfiniteScroll<E> receives a
  // well-typed response without `as unknown as` casts.
  const allModeSWRResponse = useMemo<
    SWRInfiniteResponse<PaginateResult<INewsItemWithReadStatus>, Error>
  >(
    () => ({
      data: newsResponse.data,
      error: newsResponse.error ?? notificationResponse.error,
      isValidating:
        newsResponse.isValidating || notificationResponse.isValidating,
      isLoading: newsResponse.isLoading || notificationResponse.isLoading,
      mutate: newsResponse.mutate,
      setSize: async (updater) => {
        const nextNewsSize =
          typeof updater === 'function' ? updater(newsResponse.size) : updater;
        const nextNotifSize =
          typeof updater === 'function'
            ? updater(notificationResponse.size)
            : updater;
        const [newsResult] = await Promise.all([
          newsExhausted
            ? Promise.resolve(newsResponse.data)
            : newsResponse.setSize(nextNewsSize),
          notifExhausted
            ? Promise.resolve(notificationResponse.data)
            : notificationResponse.setSize(nextNotifSize),
        ]);
        return newsResult;
      },
      size: Math.max(newsResponse.size, notificationResponse.size),
    }),
    [newsResponse, notificationResponse, newsExhausted, notifExhausted],
  );

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

  // SWR's mutate is stable per cache key — destructure once and depend on it
  // rather than the whole response object (which may carry unstable identity).
  const { mutate: mutateNews } = newsResponse;
  const { mutate: mutateNotifications } = notificationResponse;

  const handleReadMutate = useCallback(() => {
    mutateNews();
    mutateNewsUnreadCount();
  }, [mutateNews, mutateNewsUnreadCount]);

  // SWR-idiomatic optimistic update: rewrite the per-page cache in place and
  // suppress revalidation so the dot stays removed across unmount/remount.
  const handleNotificationRead = useCallback(
    (notificationId: string) => {
      mutateNotifications(
        (pages) =>
          pages?.map((page) => ({
            ...page,
            docs: page.docs.map((doc) =>
              doc._id.toString() === notificationId
                ? { ...doc, status: InAppNotificationStatuses.STATUS_OPENED }
                : doc,
            ),
          })),
        { revalidate: false },
      );
    },
    [mutateNotifications],
  );

  return {
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
  };
};
