import { useCallback } from 'react';
import type { SWRResponse } from 'swr';
import useSWR from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get, apiv3Put } from '~/client/util/apiv3-client';
import type { updateConfigMethodForAdmin } from '~/interfaces/admin';
import type { IResGrowiTheme, IResLayoutSetting } from '~/interfaces/customize';

export const useSWRxLayoutSetting = (): SWRResponse<IResLayoutSetting, Error> &
  updateConfigMethodForAdmin<IResLayoutSetting> => {
  const fetcher = useCallback(async () => {
    const res = await apiv3Get('/customize-setting/layout');
    return res.data;
  }, []);

  const swrResponse = useSWRImmutable('/customize-setting/layout', fetcher);

  const update = useCallback(
    async (layoutSetting: IResLayoutSetting) => {
      await apiv3Put('/customize-setting/layout', layoutSetting);
      await swrResponse.mutate();
    },
    [swrResponse],
  );

  return {
    ...swrResponse,
    update,
  };
};

type UpdateThemeArgs = {
  theme: string;
};
export const useSWRxGrowiThemeSetting = (): SWRResponse<IResGrowiTheme, Error> &
  updateConfigMethodForAdmin<UpdateThemeArgs> => {
  const fetcher = useCallback(async () => {
    const res = await apiv3Get<IResGrowiTheme>('/customize-setting/theme');
    return res.data;
  }, []);

  const swrResponse = useSWR('/customize-setting/theme', fetcher);

  const update = async ({ theme }: UpdateThemeArgs) => {
    await apiv3Put('/customize-setting/theme', { theme });

    if (swrResponse.data == null) {
      swrResponse.mutate();
      return;
    }

    const newData = { ...swrResponse.data, currentTheme: theme };
    swrResponse.mutate(newData, { optimisticData: newData });
  };

  return Object.assign(swrResponse, {
    update,
  });
};
