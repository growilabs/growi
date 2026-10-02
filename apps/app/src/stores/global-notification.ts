import { type SWRResponseWithUtils, withUtils } from '@growi/core/dist/swr';
import useSWRImmutable from 'swr/immutable';

import type { IGlobalNotification } from '~/client/interfaces/global-notification';

import { apiv3Get, apiv3Put } from '../client/util/apiv3-client';

type Util = {
  update(updateData: any): Promise<void>;
};

export const useSWRxGlobalNotification = (
  globalNotificationId: string,
): SWRResponseWithUtils<Util, any, Error> => {
  const swrResult = useSWRImmutable(
    globalNotificationId != null
      ? `/notification-setting/global-notification/${globalNotificationId}`
      : null,
    (endpoint) =>
      apiv3Get(endpoint).then((response) => {
        return {
          globalNotification: response.data.globalNotification,
        };
      }),
  );

  const update = async (updateData: IGlobalNotification) => {
    const { data } = swrResult;

    if (data == null) {
      return;
    }

    // invoke API
    await apiv3Put(
      `/notification-setting/global-notification/${globalNotificationId}`,
      updateData,
    );
  };

  return withUtils<Util, any, Error>(swrResult, { update });
};
