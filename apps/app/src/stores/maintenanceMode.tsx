import { type SWRResponseWithUtils, withUtils } from '@growi/core/dist/swr';

import { apiv3Post } from '~/client/util/apiv3-client';

import { useStaticSWR } from './use-static-swr';

type maintenanceModeUtils = {
  start(): Promise<void>;
  end(): Promise<void>;
};

export const useIsMaintenanceMode = (
  initialData?: boolean,
): SWRResponseWithUtils<maintenanceModeUtils, boolean> => {
  const swrResult = useStaticSWR<boolean, Error>(
    'isMaintenanceMode',
    initialData,
    { fallbackData: false },
  );

  const utils = {
    start: async () => {
      const { mutate } = swrResult;
      await apiv3Post('/app-settings/maintenance-mode', { flag: true });
      mutate(true);
    },

    end: async () => {
      const { mutate } = swrResult;
      await apiv3Post('/app-settings/maintenance-mode', { flag: false });
      mutate(false);
    },
  };

  return withUtils<maintenanceModeUtils, boolean>(swrResult, utils);
};
