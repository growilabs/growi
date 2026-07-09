import type { SWRConfiguration, SWRResponse } from 'swr';
import useSWR from 'swr';
import type { SWRInfiniteResponse } from 'swr/infinite';
import useSWRInfinite from 'swr/infinite';

import type { PaginateResult } from '~/interfaces/in-app-notification';

import { apiv3Get } from '../../../../client/util/apiv3-client';
import type { INewsItemWithReadStatus } from '../../interfaces/news-item';

const NEWS_PER_PAGE = 10;

type NewsListKey = [string, number, number, boolean] | null;

/**
 * SWRInfinite hook for paginated news items
 */
export const useSWRINFxNews = (
  limit: number = NEWS_PER_PAGE,
  options?: { onlyUnread?: boolean },
  config?: SWRConfiguration,
): SWRInfiniteResponse<PaginateResult<INewsItemWithReadStatus>, Error> => {
  const onlyUnread = options?.onlyUnread ?? false;

  return useSWRInfinite<PaginateResult<INewsItemWithReadStatus>, Error>(
    (pageIndex, previousPageData): NewsListKey => {
      if (previousPageData != null && !previousPageData.hasNextPage)
        return null;
      const offset = pageIndex * limit;
      return ['/news/list', limit, offset, onlyUnread];
    },
    ([endpoint, limit, offset, onlyUnread]) =>
      apiv3Get<PaginateResult<INewsItemWithReadStatus>>(endpoint, {
        limit,
        offset,
        onlyUnread,
      }).then((response) => response.data),
    {
      ...config,
      revalidateFirstPage: false,
    },
  );
};

/**
 * SWR hook for news unread count
 */
export const useSWRxNewsUnreadCount = (
  config?: SWRConfiguration,
): SWRResponse<number, Error> => {
  return useSWR<number, Error>(
    '/news/unread-count',
    (endpoint) =>
      apiv3Get<{ count: number }>(endpoint).then(
        (response) => response.data.count,
      ),
    config,
  );
};

type NewsPageKey = [string, number, number, boolean] | null;

/**
 * SWR hook for a single paginated page of news items. Used by the /_news feed
 * page (page-by-page navigation), as opposed to `useSWRINFxNews` which is used
 * by the sidebar (infinite scroll).
 *
 * Fetching a specific page instead of walking pages via infinite scroll avoids
 * loading N-1 pages just to reach an anchored item near the bottom of a long
 * feed.
 */
export const useSWRxNewsPage = (
  page: number,
  limit: number = NEWS_PER_PAGE,
  options?: { onlyUnread?: boolean },
  config?: SWRConfiguration,
): SWRResponse<PaginateResult<INewsItemWithReadStatus>, Error> => {
  const onlyUnread = options?.onlyUnread ?? false;
  const offset = Math.max(0, page - 1) * limit;

  return useSWR<PaginateResult<INewsItemWithReadStatus>, Error>(
    ['/news/list', limit, offset, onlyUnread] as NewsPageKey,
    ([endpoint, limit, offset, onlyUnread]) =>
      apiv3Get<PaginateResult<INewsItemWithReadStatus>>(endpoint, {
        limit,
        offset,
        onlyUnread,
      }).then((response) => response.data),
    {
      keepPreviousData: true,
      ...config,
    },
  );
};
