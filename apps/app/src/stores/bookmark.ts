import type { IPageHasId, IUser } from '@growi/core/dist/interfaces';
import type { IUserSerializedSecurely } from '@growi/core/dist/models/serializers';
import type { SWRResponse } from 'swr';
import useSWR from 'swr';
import useSWRImmutable from 'swr/immutable';
import useSWRMutation, { type SWRMutationResponse } from 'swr/mutation';

import { useCurrentUser } from '~/states/global';

import { apiv3Get } from '../client/util/apiv3-client';
import type { IBookmarkInfo } from '../interfaces/bookmark-info';

export const useSWRxBookmarkedUsers = (
  pageId: string | null,
): SWRResponse<IUserSerializedSecurely<IUser>[], Error> => {
  return useSWR(
    pageId != null ? `/bookmarks/info?pageId=${pageId}` : null,
    (endpoint) =>
      apiv3Get<IBookmarkInfo>(endpoint).then(
        (response) => response.data.bookmarkedUsers,
      ),
  );
};

export const useSWRxUserBookmarks = (
  userId: string | null,
): SWRResponse<(IPageHasId | null)[], Error> => {
  return useSWRImmutable(
    userId != null ? `/bookmarks/${userId}` : null,
    (endpoint) =>
      apiv3Get(endpoint).then((response) => {
        const { userRootBookmarks } = response.data;
        return userRootBookmarks.map((item) => item.page); // page will be null if the page is deleted
      }),
  );
};

export const useSWRMUTxCurrentUserBookmarks = (): SWRMutationResponse<
  (IPageHasId | null)[],
  Error
> => {
  const currentUser = useCurrentUser();

  return useSWRMutation(
    currentUser != null ? `/bookmarks/${currentUser?._id}` : null,
    (endpoint) =>
      apiv3Get(endpoint).then((response) => {
        const { userRootBookmarks } = response.data;
        return userRootBookmarks.map((item) => item.page); // page will be null if the page is deleted
      }),
  );
};
