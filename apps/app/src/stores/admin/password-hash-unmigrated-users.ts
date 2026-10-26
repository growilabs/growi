import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { PasswordHashUnmigratedUsersResponse } from '~/interfaces/password-hash-status';

export const UNMIGRATED_USERS_PAGE_SIZE = 20;

export const useSWRxPasswordHashUnmigratedUsers = (
  page: number,
): SWRResponse<PasswordHashUnmigratedUsersResponse, Error> => {
  return useSWRImmutable(
    ['/security-setting/password-hash-unmigrated-users', page],
    async ([endpoint, pageNumber]) => {
      const { data } = await apiv3Get<PasswordHashUnmigratedUsersResponse>(
        endpoint,
        { page: pageNumber, limit: UNMIGRATED_USERS_PAGE_SIZE },
      );
      // A redirect (e.g. to /login) can yield an HTML body with HTTP 200.
      if (data?.users == null) {
        throw new Error('Unmigrated users response has no users');
      }
      return data;
    },
    // Keep the current page visible while the next one loads.
    { keepPreviousData: true },
  );
};
