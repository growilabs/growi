import { useCallback } from 'react';
import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get, apiv3Put } from '~/client/util/apiv3-client';
import type { ISidebarConfig } from '~/interfaces/sidebar-config';

type SidebarConfigOption = {
  update: () => Promise<void>;

  setIsSidebarCollapsedMode: (isSidebarCollapsedMode: boolean) => void;
  setIsSidebarClosedAtDockMode: (
    isSidebarClosedAtDockMode: boolean | undefined,
  ) => void;
};

export const useSWRxSidebarConfig = (): SWRResponse<ISidebarConfig, Error> &
  SidebarConfigOption => {
  const swrResponse = useSWRImmutable<ISidebarConfig>(
    '/customize-setting/sidebar',
    (endpoint) =>
      apiv3Get<ISidebarConfig>(endpoint).then((result) => result.data),
    {
      keepPreviousData: true,
    },
  );

  const { data, mutate } = swrResponse;

  return {
    ...swrResponse,
    update: useCallback(async () => {
      if (data == null) {
        return;
      }

      // invoke API
      await apiv3Put<ISidebarConfig>('/customize-setting/sidebar', data);
    }, [data]),

    setIsSidebarCollapsedMode: useCallback(
      (isSidebarCollapsedMode) => {
        // update isSidebarCollapsedMode in cache, not revalidate
        mutate((prevData) => {
          if (prevData == null) {
            return;
          }

          return { ...prevData, isSidebarCollapsedMode };
        }, false);
      },
      [mutate],
    ),

    setIsSidebarClosedAtDockMode: useCallback(
      (isSidebarClosedAtDockMode) => {
        // update isSidebarClosedAtDockMode in cache, not revalidate
        mutate((prevData) => {
          if (prevData == null) {
            return;
          }
          return { ...prevData, isSidebarClosedAtDockMode };
        }, false);
      },
      [mutate],
    ),
  };
};
