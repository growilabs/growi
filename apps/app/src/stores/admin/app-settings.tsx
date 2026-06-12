import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { IResAppSettings } from '~/interfaces/res/admin/app-settings';

export const useSWRxAppSettings = (): SWRResponse<IResAppSettings, Error> => {
  return useSWR('/app-settings/', (endpoint) =>
    apiv3Get(endpoint).then((response) => {
      return response.data.appSettingsParams;
    }),
  );
};
