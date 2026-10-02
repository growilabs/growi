import type { SWRConfiguration, SWRResponse } from 'swr';
import useSWR from 'swr';
import type { SWRInfiniteResponse } from 'swr/infinite';
import useSWRInfinite from 'swr/infinite';

import type { PaginateResult } from '~/interfaces/in-app-notification';

import { apiv3Get } from '../../../../client/util/apiv3-client';
import type { INewsItemWithReadStatus } from '../../interfaces/news-item';
import { NEWS_PER_PAGE } from '../consts';

/** SWR cache key for one page of /news/list. */
type NewsListKey = [
  endpoint: string,
  limit: number,
  offset: number,
  onlyUnread: boolean,
];

/** Shared fetcher for every /news/list key (infinite and single-page). */
const fetchNewsPage = ([
  endpoint,
  limit,
  offset,
  onlyUnread,
]: NewsListKey): Promise<PaginateResult<INewsItemWithReadStatus>> =>
  apiv3Get<PaginateResult<INewsItemWithReadStatus>>(endpoint, {
    limit,
    offset,
    onlyUnread,
  }).then((response) => response.data);

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
    (pageIndex, previousPageData): NewsListKey | null => {
      if (previousPageData != null && !previousPageData.hasNextPage)
        return null;
      const offset = pageIndex * limit;
      return ['/news/list', limit, offset, onlyUnread];
    },
    fetchNewsPage,
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

/**
 * SWR hook for a single paginated page of the full news feed. Used by the
 * /_news feed page (page-by-page navigation), as opposed to `useSWRINFxNews`
 * which is used by the sidebar (infinite scroll).
 *
 * Fetching a specific page instead of walking pages via infinite scroll avoids
 * loading N-1 pages just to reach an anchored item near the bottom of a long
 * feed.
 */
export const useSWRxNewsPage = (
  page: number,
  limit: number = NEWS_PER_PAGE,
  config?: SWRConfiguration,
): SWRResponse<PaginateResult<INewsItemWithReadStatus>, Error> => {
  const offset = Math.max(0, page - 1) * limit;

  return useSWR<PaginateResult<INewsItemWithReadStatus>, Error>(
    ['/news/list', limit, offset, false] satisfies NewsListKey,
    fetchNewsPage,
    {
      keepPreviousData: true,
      ...config,
    },
  );
};
