import type { IPageHasId } from '@growi/core';
import type { SWRInfiniteResponse } from 'swr/infinite';
import useSWRInfinite from 'swr/infinite';

import { apiv3Get } from '~/client/util/apiv3-client';

type PageTimelineResult = {
  pages: IPageHasId[];
  totalCount: number;
  offset: number;
};
export const useSWRINFxPageTimeline = (
  path: string | undefined,
  limit: number,
): SWRInfiniteResponse<PageTimelineResult, Error> => {
  return useSWRInfinite(
    (pageIndex, previousPageData) => {
      if (previousPageData != null && previousPageData.pages.length === 0)
        return null;
      if (path === undefined) return null;

      return ['/pages/list', path, pageIndex + 1, limit];
    },
    ([endpoint, path, page, limit]) =>
      apiv3Get<PageTimelineResult>(endpoint, { path, page, limit }).then(
        (response) => response.data,
      ),
    {
      revalidateFirstPage: false,
      revalidateAll: false,
    },
  );
};
