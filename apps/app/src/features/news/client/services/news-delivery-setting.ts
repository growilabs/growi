import { useCallback } from 'react';
import useSWR, { type SWRResponse } from 'swr';

import { apiv3Get, apiv3Post } from '~/client/util/apiv3-client.js';

const ENDPOINT = '/news/admin/delivery-setting';

type DeliverySettingResponse = {
  isDeliveryEnabled: boolean;
};

/**
 * Fetch the current value of `news:isDeliveryEnabled` (admin only).
 */
export const useSWRxNewsDeliverySetting = (): SWRResponse<
  DeliverySettingResponse,
  Error
> => {
  return useSWR(
    ENDPOINT,
    async (endpoint) =>
      (await apiv3Get<DeliverySettingResponse>(endpoint)).data,
  );
};

/**
 * Returns a callback that updates the news delivery flag on the server and
 * revalidates the SWR cache so the UI reflects the new value.
 */
export const useUpdateNewsDeliverySetting = (): ((
  flag: boolean,
) => Promise<void>) => {
  const { mutate } = useSWRxNewsDeliverySetting();

  return useCallback(
    async (flag: boolean) => {
      await apiv3Post(ENDPOINT, { flag });
      await mutate({ isDeliveryEnabled: flag }, { revalidate: false });
    },
    [mutate],
  );
};
