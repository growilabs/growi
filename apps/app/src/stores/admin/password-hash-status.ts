import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get } from '~/client/util/apiv3-client';
import type {
  PasswordHashFormatCounts,
  PasswordHashStatusResponse,
} from '~/interfaces/password-hash-status';

const STATUS_ENDPOINT = '/security-setting/password-hash-status';

export const fetchPasswordHashStatus =
  async (): Promise<PasswordHashFormatCounts> => {
    const { data } =
      await apiv3Get<PasswordHashStatusResponse>(STATUS_ENDPOINT);
    // A redirect (e.g. to /login) can yield an HTML body with HTTP 200.
    if (data?.counts == null) {
      throw new Error('Password hash status response has no counts');
    }
    return data.counts;
  };

export const useSWRxPasswordHashStatus = (): SWRResponse<
  PasswordHashFormatCounts,
  Error
> => {
  // Refetch whenever the section mounts again (e.g. after client-side
  // navigation) so the counts are not left at a stale cached value.
  return useSWRImmutable(STATUS_ENDPOINT, fetchPasswordHashStatus, {
    revalidateOnMount: true,
  });
};
