import type {
  HasObjectId,
  IDataWithMeta,
  IPageHasId,
  IPageInfoForListing,
  IPageInfoForOperation,
  Nullable,
} from '@growi/core';
import assert from 'assert';
import useSWR, {
  type Arguments,
  mutate,
  type SWRConfiguration,
  type SWRResponse,
} from 'swr';
import useSWRImmutable from 'swr/immutable';
import type { SWRInfiniteResponse } from 'swr/infinite';
import useSWRInfinite, { unstable_serialize } from 'swr/infinite'; // eslint-disable-line camelcase

import type { IPagingResult } from '~/interfaces/paging-result';

import { apiv3Get } from '../client/util/apiv3-client';
import type {
  ChildrenResult,
  RootPageResult,
  V5MigrationStatus,
} from '../interfaces/page-listing-results';

export const useSWRxPagesByPath = (
  path?: Nullable<string>,
): SWRResponse<IPageHasId[], Error> => {
  const findAll = true;
  const includeEmpty = true;
  return useSWR(
    path != null ? ['/page', path, findAll, includeEmpty] : null,
    ([endpoint, path, findAll, includeEmpty]) =>
      apiv3Get(endpoint, { path, findAll, includeEmpty }).then(
        (result) => result.data.pages,
      ),
  );
};

type RecentApiResult = {
  pages: IPageHasId[];
  totalCount: number;
  offset: number;
};

export const getRecentlyUpdatedKey = (
  pageIndex: number,
  previousPageData: RecentApiResult | null,
  includeWipPage?: boolean,
): [string, number | undefined, boolean | undefined] | null => {
  if (previousPageData != null && previousPageData.pages.length === 0)
    return null;

  if (pageIndex === 0 || previousPageData == null) {
    return ['/pages/recent', undefined, includeWipPage];
  }
  const offset = previousPageData.offset + previousPageData.pages.length;
  return ['/pages/recent', offset, includeWipPage];
};

export const useSWRINFxRecentlyUpdated = (
  includeWipPage?: boolean,
  config?: SWRConfiguration,
): SWRInfiniteResponse<RecentApiResult, Error> => {
  const PER_PAGE = 20;
  return useSWRInfinite(
    (pageIndex, previousPageData) =>
      getRecentlyUpdatedKey(pageIndex, previousPageData, includeWipPage),
    ([endpoint, offset, includeWipPage]) =>
      apiv3Get<RecentApiResult>(endpoint, {
        offset,
        limit: PER_PAGE,
        includeWipPage,
      }).then((response) => response.data),
    {
      ...config,
      revalidateFirstPage: false,
      revalidateAll: true,
    },
  );
};

export const mutateRecentlyUpdated = async (): Promise<undefined> => {
  [true, false].forEach((includeWipPage) => {
    mutate(
      unstable_serialize((pageIndex, previousPageData) =>
        getRecentlyUpdatedKey(pageIndex, previousPageData, includeWipPage),
      ),
    );
  });
  return;
};

export const mutatePageList = async (): Promise<void[]> => {
  return mutate((key) => Array.isArray(key) && key[0] === '/pages/list');
};

export const useSWRxPageList = (
  path: string | null,
  pageNumber?: number,
  limit?: number,
): SWRResponse<IPagingResult<IPageHasId>, Error> => {
  return useSWR(
    path == null ? null : ['/pages/list', path, pageNumber, limit],
    ([endpoint, path, pageNumber, limit]) => {
      const args = Object.assign(
        { path, page: pageNumber ?? 1 },
        // if limit exist then add it as query string
        limit != null ? { limit } : {},
      );

      return apiv3Get<{
        pages: IPageHasId[];
        totalCount: number;
        limit: number;
      }>(endpoint, args).then((response) => {
        return {
          items: response.data.pages,
          totalCount: response.data.totalCount,
          limit: response.data.limit,
        };
      });
    },
    {
      keepPreviousData: true,
    },
  );
};

type PageInfoInjector = {
  injectTo: <D extends HasObjectId>(
    pages: (D | IDataWithMeta<D>)[],
  ) => IDataWithMeta<D, IPageInfoForOperation>[];
};

const isIDataWithMeta = (
  item: HasObjectId | IDataWithMeta,
): item is IDataWithMeta => {
  return 'data' in item;
};

export const useSWRxPageInfoForList = (
  pageIds: string[] | null | undefined,
  path: string | null | undefined = null,
  attachBookmarkCount = false,
  attachShortBody = false,
): SWRResponse<Record<string, IPageInfoForListing>, Error> &
  PageInfoInjector => {
  const shouldFetch = (pageIds != null && pageIds.length > 0) || path != null;

  const swrResult = useSWRImmutable(
    shouldFetch
      ? [
          '/page-listing/info',
          pageIds,
          path,
          attachBookmarkCount,
          attachShortBody,
        ]
      : null,
    ([endpoint, pageIds, path, attachBookmarkCount, attachShortBody]) => {
      return apiv3Get(endpoint, {
        pageIds: pageIds != null ? pageIds : undefined, // Do not pass null to avoid empty query parameter
        path: path != null ? path : undefined, // Do not pass null to avoid empty query parameter
        attachBookmarkCount,
        attachShortBody,
      }).then((response) => response.data);
    },
  );

  return {
    ...swrResult,
    injectTo: <D extends HasObjectId>(pages: (D | IDataWithMeta<D>)[]) => {
      return pages.map((item) => {
        const page = isIDataWithMeta(item) ? item.data : item;
        const orgPageMeta = isIDataWithMeta(item) ? item.meta : undefined;

        // get an applicable IPageInfo
        const applicablePageInfo = (swrResult.data ?? {})[page._id];

        return {
          data: page,
          meta: applicablePageInfo ?? orgPageMeta,
        };
      });
    },
  };
};

const MUTATION_ID_FOR_PAGETREE = 'pageTree';
const keyMatcherForPageTree = (key: Arguments): boolean => {
  return Array.isArray(key) && key[0] === MUTATION_ID_FOR_PAGETREE;
};
export const mutatePageTree = async (): Promise<undefined[]> => {
  return mutate(keyMatcherForPageTree);
};

export const useSWRxRootPage = (
  config?: SWRConfiguration,
): SWRResponse<RootPageResult, Error> => {
  return useSWR(
    [MUTATION_ID_FOR_PAGETREE, '/page-listing/root'],
    ([, endpoint]) =>
      apiv3Get(endpoint).then((response) => {
        return {
          rootPage: response.data.rootPage,
        };
      }),
    {
      ...config,
      keepPreviousData: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};

export const useSWRxPageChildren = (
  id?: string | null,
): SWRResponse<ChildrenResult, Error> => {
  const key = id
    ? [MUTATION_ID_FOR_PAGETREE, '/page-listing/children', id]
    : null;

  if (key != null) {
    assert(keyMatcherForPageTree(key));
  }

  return useSWR(
    key,
    ([, endpoint, id]) =>
      apiv3Get(endpoint, { id }).then((response) => {
        return {
          children: response.data.children,
        };
      }),
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      revalidateOnRecconect: false,
    },
  );
};

export const useSWRxV5MigrationStatus = (
  config?: SWRConfiguration,
): SWRResponse<V5MigrationStatus, Error> => {
  return useSWRImmutable(
    '/pages/v5-migration-status',
    (endpoint) =>
      apiv3Get(endpoint).then((response) => {
        return {
          isV5Compatible: response.data.isV5Compatible,
          migratablePagesCount: response.data.migratablePagesCount,
        };
      }),
    config,
  );
};
