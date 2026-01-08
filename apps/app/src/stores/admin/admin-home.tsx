import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';

export type AdminHomeData = {
  growiVersion: string;
  nodeVersion: string;
  npmVersion: string;
  pnpmVersion: string;
  envVars: Record<string, string>;
  isV5Compatible: boolean;
  isMaintenanceMode: boolean;
};

export const useSWRxAdminHome = (): SWRResponse<AdminHomeData, Error> => {
  return useSWR('/admin-home/', (endpoint) =>
    apiv3Get(endpoint).then((response) => {
      return response.data.adminHomeParams;
    }),
  );
};
