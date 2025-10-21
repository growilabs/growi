import type { SWRConfiguration, SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';
import type { SWRInfiniteResponse } from 'swr/infinite';
import useSWRInfinite from 'swr/infinite';
import useSWRMutation, { type SWRMutationResponse } from 'swr/mutation';

import { apiv3Get } from '~/client/util/apiv3-client';
import type {
  IThreadRelationHasId,
  IThreadRelationPaginate,
} from '~/features/openai/interfaces/thread-relation';

const getKey = (aiAssistantId?: string) =>
  aiAssistantId != null ? [`/openai/threads/${aiAssistantId}`] : null;

export const useSWRxThreads = (
  aiAssistantId?: string,
): SWRResponse<IThreadRelationHasId[], Error> => {
  const key = getKey(aiAssistantId);
  return useSWRImmutable<IThreadRelationHasId[]>(key, ([endpoint]) =>
    apiv3Get(endpoint).then((response) => response.data.threads),
  );
};

export const useSWRMUTxThreads = (
  aiAssistantId?: string,
): SWRMutationResponse<IThreadRelationHasId[], Error> => {
  const key = getKey(aiAssistantId);
  return useSWRMutation(
    key,
    ([endpoint]) =>
      apiv3Get(endpoint).then((response) => response.data.threads),
    { revalidate: true },
  );
};

const getRecentThreadsKey = (
  pageIndex: number,
  previousPageData: IThreadRelationPaginate | null,
): [string, number, number] | null => {
  if (previousPageData && !previousPageData.paginateResult.hasNextPage) {
    return null;
  }

  const PER_PAGE = 20;
  const page = pageIndex + 1;

  return ['/openai/threads/recent', page, PER_PAGE];
};

export const useSWRINFxRecentThreads = (
  config?: SWRConfiguration,
): SWRInfiniteResponse<IThreadRelationPaginate, Error> => {
  return useSWRInfinite(
    (pageIndex, previousPageData) =>
      getRecentThreadsKey(pageIndex, previousPageData),
    ([endpoint, page, limit]) =>
      apiv3Get<IThreadRelationPaginate>(endpoint, { page, limit }).then(
        (response) => response.data,
      ),
    {
      ...config,
      revalidateFirstPage: false,
      revalidateAll: true,
    },
  );
};
