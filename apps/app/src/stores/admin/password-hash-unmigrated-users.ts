import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { IPasswordHashUnmigratedUserList } from '~/interfaces/password-hash-migration';

/**
 * Fetch one page of the users that still hold an old-format credential.
 *
 * Separate from the status hook because the cost is different: the distribution is
 * four counts and loads with the section, while this reads documents and is only
 * worth fetching once the administrator asks to see who is left. `isEnabled` is
 * what keeps it from firing until then.
 */
export const useSWRxPasswordHashUnmigratedUsers = (
  page: number,
  isEnabled: boolean,
): SWRResponse<IPasswordHashUnmigratedUserList, Error> => {
  return useSWR(
    isEnabled
      ? ['/security-setting/password-hash/unmigrated-users', page]
      : null,
    ([endpoint, currentPage]) =>
      apiv3Get(endpoint, { page: currentPage }).then(
        (response) => response.data,
      ),
  );
};
