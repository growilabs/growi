import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';

export const useSWRxStaffs = (): SWRResponse<any, Error> => {
  return useSWR('/staffs', (endpoint) =>
    apiv3Get(endpoint).then((response) => {
      return response.data.contributors;
    }),
  );
};
