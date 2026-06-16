import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';

import type { IGrowiPluginHasId } from '../../../interfaces';

type Plugins = {
  plugins: IGrowiPluginHasId[];
};

export const useSWRxAdminPlugins = (): SWRResponse<Plugins, Error> => {
  return useSWR('/plugins', async (endpoint) => {
    try {
      const res = await apiv3Get<Plugins>(endpoint);
      return res.data;
    } catch (err) {
      throw new Error(err);
    }
  });
};
