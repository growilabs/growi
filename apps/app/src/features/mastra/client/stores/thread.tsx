import type { SWRConfiguration } from 'swr';
import type { SWRInfiniteResponse } from 'swr/infinite';
import useSWRInfinite from 'swr/infinite';

import { apiv3Get } from '~/client/util/apiv3-client';
import type {
  IApiv3GetThreadsParams,
  ThreadListOutput,
} from '~/features/mastra/interfaces/thread';

const getRecentThreadsKey = (
  pageIndex: number,
  previousPageData: ThreadListOutput | null,
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
): SWRInfiniteResponse<ThreadListOutput, Error> => {
  return useSWRInfinite(
    (pageIndex, previousPageData) =>
      getRecentThreadsKey(pageIndex, previousPageData),
    ([endpoint, page, perPage]) => {
      const params: IApiv3GetThreadsParams = {
        field: 'updatedAt',
        direction: 'DESC',
        page,
        perPage,
      };
      return apiv3Get<{ paginatedThread: ThreadListOutput }>(
        endpoint,
        params,
      ).then((response) => response.data.paginatedThread);
    },
    {
      ...config,
      initialSize: 0,
    },
  );
};
