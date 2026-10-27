import type { SWRInfiniteResponse } from 'swr/infinite';
import useSWRInfinite from 'swr/infinite';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { PasswordHashUnmigratedUsersResponse } from '~/interfaces/password-hash-status';

const UNMIGRATED_USERS_PAGE_SIZE = 20;

const ENDPOINT = '/security-setting/password-hash-unmigrated-users';

type UnmigratedUsersKey = [typeof ENDPOINT, number] | null;

/**
 * Judged per page because the total can shrink between pages when users
 * migrate mid-scroll; the hook and the list must share this single rule or
 * the list keeps asking for pages the hook will never fetch.
 */
export const isLastUnmigratedUsersPage = (
  page: PasswordHashUnmigratedUsersResponse,
): boolean => page.page * page.limit >= page.totalCount;

export const useSWRInfinitePasswordHashUnmigratedUsers =
  (): SWRInfiniteResponse<PasswordHashUnmigratedUsersResponse, Error> => {
    return useSWRInfinite<PasswordHashUnmigratedUsersResponse, Error>(
      (pageIndex, previousPageData): UnmigratedUsersKey => {
        if (
          previousPageData != null &&
          isLastUnmigratedUsersPage(previousPageData)
        ) {
          return null;
        }
        return [ENDPOINT, pageIndex + 1];
      },
      async ([endpoint, page]: [string, number]) => {
        const { data } = await apiv3Get<PasswordHashUnmigratedUsersResponse>(
          endpoint,
          { page, limit: UNMIGRATED_USERS_PAGE_SIZE },
        );
        // A redirect (e.g. to /login) can yield an HTML body with HTTP 200.
        if (data?.users == null) {
          throw new Error('Unmigrated users response has no users');
        }
        return data;
      },
      // revalidateOnMount refetches the loaded pages when the list mounts
      // again, so users who migrated meanwhile drop out of a cached list.
      { revalidateFirstPage: false, revalidateOnMount: true },
    );
  };
