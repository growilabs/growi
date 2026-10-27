import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { IContributionsResponse } from '~/features/contribution-graph/interfaces/contribution';

export const useSWRxContributions = (
  userId: string | null,
): SWRResponse<IContributionsResponse, Error> => {
  const key =
    userId != null ? `/user/contributions?targetUserId=${userId}` : null;

  return useSWR(key, (endpoint) =>
    apiv3Get(endpoint).then((response) => {
      return response.data;
    }),
  );
};
