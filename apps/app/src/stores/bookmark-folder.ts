import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { BookmarkFolderItems } from '~/interfaces/bookmark-info';

export const useSWRxBookmarkFolderAndChild = (
  userId?: string,
): SWRResponse<BookmarkFolderItems[], Error> => {
  return useSWRImmutable(
    userId != null ? `/bookmark-folder/list/${userId}` : null,
    (endpoint) =>
      apiv3Get(endpoint).then((response) => {
        return response.data.bookmarkFolderItems;
      }),
  );
};
