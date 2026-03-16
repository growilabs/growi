import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { IContributionDay } from '~/features/contribution-graph/interfaces/contribution-graph';

export const useSWRxContributions = (
  userId: string | null,
): SWRResponse<IContributionDay[], Error> => {
  const key = userId ? `/user/contributions?targetUserId=${userId}` : null;

  return useSWR(key, (endpoint) =>
    apiv3Get(endpoint).then((response) => {
      return response.data.contributions;
    }),
  );
};
