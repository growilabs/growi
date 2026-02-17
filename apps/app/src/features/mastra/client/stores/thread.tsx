import type { StorageListThreadsOutput } from '@mastra/core/storage';
import type { SWRConfiguration } from 'swr';
import type { SWRInfiniteResponse } from 'swr/infinite';
import useSWRInfinite from 'swr/infinite';

import { apiv3Get } from '~/client/util/apiv3-client';

const getRecentThreadsKey = (
  pageIndex: number,
  previousPageData: StorageListThreadsOutput | null,
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
): SWRInfiniteResponse<StorageListThreadsOutput, Error> => {
  return useSWRInfinite(
    (pageIndex, previousPageData) =>
      getRecentThreadsKey(pageIndex, previousPageData),
    ([endpoint, page, perPage]) =>
      apiv3Get<{ paginatedThread: StorageListThreadsOutput }>(endpoint, {
        page,
        perPage,
      }).then((response) => response.data.paginatedThread),
    {
      ...config,
      initialSize: 0,
    },
  );
};
