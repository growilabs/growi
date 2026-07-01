import type { IUserHasId } from '@growi/core';
import type { SWRResponse } from 'swr';
import useSWR from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { PopulatedGrantedGroup } from '~/interfaces/page-grant';
import { useIsGuestUser } from '~/states/context';
import { checkAndUpdateImageUrlCached } from '~/stores/middlewares/user';

export const useSWRxUsersList = (
  userIds: string[],
): SWRResponse<IUserHasId[], Error> => {
  const isGuestUser = useIsGuestUser();
  const distinctUserIds =
    userIds.length > 0 ? Array.from(new Set(userIds)).sort() : [];

  const shouldFetch = !isGuestUser && distinctUserIds.length > 0;

  return useSWR(
    shouldFetch ? ['/users/list', distinctUserIds] : null,
    ([endpoint, userIds]) =>
      apiv3Get(endpoint, { userIds: userIds.join(',') }).then((response) => {
        return response.data.users;
      }),
    {
      use: [checkAndUpdateImageUrlCached],
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};

type usernameRequestOptions = {
  isIncludeActiveUser?: boolean;
  isIncludeInactiveUser?: boolean;
  isIncludeActivitySnapshotUser?: boolean;
  isIncludeMixedUsernames?: boolean;
};

type userData = {
  usernames: string[];
  totalCount: number;
};

type usernameResult = {
  activeUser?: userData;
  inactiveUser?: userData;
  activitySnapshotUser?: userData;
  mixedUsernames?: string[];
};

export const useSWRxUsernames = (
  q: string,
  offset?: number,
  limit?: number,
  options?: usernameRequestOptions,
): SWRResponse<usernameResult, Error> => {
  return useSWRImmutable(
    q != null && q.trim() !== ''
      ? ['/users/usernames', q, offset, limit, JSON.stringify(options)]
      : null,
    ([endpoint, q, offset, limit, options]) =>
      apiv3Get(endpoint, {
        q,
        offset,
        limit,
        options,
      }).then((result) => result.data),
  );
};

type RelatedGroupsResponse = {
  relatedGroups: PopulatedGrantedGroup[];
};

export const useSWRxUserRelatedGroups = (): SWRResponse<
  RelatedGroupsResponse,
  Error
> => {
  return useSWRImmutable<RelatedGroupsResponse>(
    ['/user/related-groups'],
    ([endpoint]) => apiv3Get(endpoint).then((response) => response.data),
  );
};
