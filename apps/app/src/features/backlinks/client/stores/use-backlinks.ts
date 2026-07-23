import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';

import type { IBacklinkResponse } from '../../interfaces/backlink';

export const useSWRxBacklinks = (
  pageId: string | null,
): SWRResponse<IBacklinkResponse, Error> => {
  const key = pageId != null ? `/page/backlinks?=${pageId}` : null;

  return useSWR(key, (endpoint) =>
    apiv3Get(endpoint).then((response) => {
      return response.data;
    }),
  );
};
