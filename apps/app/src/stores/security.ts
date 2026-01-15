import useSWR from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';

export const useSWRxSecuritySettings = () => {
  return useSWR('/security-setting', () =>
    apiv3Get('/security-setting').then(res => {
      return res.data.securityParams.generalSetting;
    })
  );
};
