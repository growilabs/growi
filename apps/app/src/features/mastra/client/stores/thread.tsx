import type { PaginationInfo, StorageThreadType } from '@mastra/core';
import type { SWRConfiguration } from 'swr';
import type { SWRInfiniteResponse } from 'swr/infinite';
import useSWRInfinite from 'swr/infinite';

import { apiv3Get } from '~/client/util/apiv3-client';

type PaginatedThread = PaginationInfo & { threads: StorageThreadType[] };

const getRecentThreadsKey = (
  pageIndex: number,
  previousPageData: PaginatedThread | null,
): [string, number, number] | null => {
  if (previousPageData != null && !previousPageData.hasMore) {
    return null;
  }

  const PER_PAGE = 20;
  const page = pageIndex;

  return ['/mastra/threads', page, PER_PAGE];
};

export const useSWRINFxRecentThreads = (
  config?: SWRConfiguration,
): SWRInfiniteResponse<PaginatedThread, Error> => {
  return useSWRInfinite(
    (pageIndex, previousPageData) =>
      getRecentThreadsKey(pageIndex, previousPageData),
    ([endpoint, page, perPage]) =>
      apiv3Get<{ paginatedThread: PaginatedThread }>(endpoint, {
        page,
        perPage,
      }).then((response) => response.data.paginatedThread),
    {
      ...config,
      initialSize: 0,
    },
  );
};
