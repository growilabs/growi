import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiGet } from '~/client/util/apiv1-client';
import type { IResTagsListApiv1, IResTagsSearchApiv1 } from '~/interfaces/tag';

export const useSWRxTagsList = (
  limit?: number,
  offset?: number,
): SWRResponse<IResTagsListApiv1, Error> => {
  return useSWR(
    ['/tags.list', limit, offset],
    ([endpoint, limit, offset]) =>
      apiGet(endpoint, { limit, offset }).then(
        (result: IResTagsListApiv1) => result,
      ),
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};

export const useSWRxTagsSearch = (
  query: string,
): SWRResponse<IResTagsSearchApiv1, Error> => {
  return useSWR(
    ['/tags.search', query],
    ([endpoint, query]) =>
      apiGet(endpoint, { q: query }).then(
        (result: IResTagsSearchApiv1) => result,
      ),
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};
