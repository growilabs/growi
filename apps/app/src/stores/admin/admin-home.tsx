import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client.js';
import type { IResAdminHome } from '~/interfaces/res/admin/admin-home.js';

export const useSWRxAdminHome = (): SWRResponse<IResAdminHome, Error> => {
  return useSWR('/admin-home/', (endpoint) =>
    apiv3Get(endpoint).then((response) => {
      return response.data.adminHomeParams;
    }),
  );
};
