import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get } from '~/client/util/apiv3-client';
import type {
  PasswordHashFormatCounts,
  PasswordHashStatusResponse,
} from '~/interfaces/password-hash-status';

export const useSWRxPasswordHashStatus = (): SWRResponse<
  PasswordHashFormatCounts,
  Error
> => {
  return useSWRImmutable(
    '/security-setting/password-hash-status',
    async (endpoint) => {
      const { data } = await apiv3Get<PasswordHashStatusResponse>(endpoint);
      // A redirect (e.g. to /login) can yield an HTML body with HTTP 200.
      if (data?.counts == null) {
        throw new Error('Password hash status response has no counts');
      }
      return data.counts;
    },
  );
};
