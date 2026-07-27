import type { SWRResponse } from 'swr';
import useSWR, { mutate } from 'swr';
import type { SWRInfiniteResponse } from 'swr/infinite';
import useSWRInfinite from 'swr/infinite';

import { apiGet } from '~/client/util/apiv1-client';
import type { IFormattedSearchResult } from '~/interfaces/search';
import { SORT_AXIS, SORT_ORDER } from '~/interfaces/search';

export type ISearchConfigurations = {
  limit: number;
  offset?: number;
  sort?: SORT_AXIS;
  order?: SORT_ORDER;
  includeTrashPages?: boolean;
  includeUserPages?: boolean;
};

type ISearchConfigurationsFixed = {
  limit: number;
  offset: number;
  sort: SORT_AXIS;
  order: SORT_ORDER;
  includeTrashPages: boolean;
  includeUserPages: boolean;
};

export type ISearchConditions = ISearchConfigurationsFixed & {
  keyword: string | null;
  rawQuery: string;
};

const createSearchQuery = (
  keyword: string,
  includeTrashPages: boolean,
  includeUserPages: boolean,
): string => {
  let query = keyword;

  // pages included in specific path are not retrived when prefix is added
  if (!includeTrashPages) {
    query = `${query} -prefix:/trash`;
  }
  if (!includeUserPages) {
    query = `${query} -prefix:/user`;
  }

  return query;
};

export const mutateSearching = async (): Promise<void[]> => {
  return mutate((key) => Array.isArray(key) && key[0] === '/search');
};

export const useSWRxSearch = (
  keyword: string | null,
  nqName: string | null,
  configurations: ISearchConfigurations,
): SWRResponse<IFormattedSearchResult, Error> & {
  conditions: ISearchConditions;
} => {
  const { limit, offset, sort, order, includeTrashPages, includeUserPages } =
    configurations;

  const fixedConfigurations: ISearchConfigurationsFixed = {
    limit,
    offset: offset ?? 0,
    sort: sort ?? SORT_AXIS.RELATION_SCORE,
    order: order ?? SORT_ORDER.DESC,
    includeTrashPages: includeTrashPages ?? false,
    includeUserPages: includeUserPages ?? false,
  };
  const rawQuery = createSearchQuery(
    keyword ?? '',
    fixedConfigurations.includeTrashPages,
    fixedConfigurations.includeUserPages,
  );

  const isKeywordValid = keyword != null && keyword.length > 0;

  const swrResult = useSWR(
    isKeywordValid ? ['/search', keyword, fixedConfigurations] : null,
    ([endpoint, , fixedConfigurations]) => {
      const { limit, offset, sort, order } = fixedConfigurations;

      return apiGet(endpoint, {
        q: encodeURIComponent(rawQuery),
        nq: typeof nqName === 'string' ? encodeURIComponent(nqName) : null,
        limit,
        offset,
        sort,
        order,
      }).then((result) => result as IFormattedSearchResult);
    },
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
    },
  );

  return {
    ...swrResult,
    conditions: {
      keyword,
      rawQuery,
      ...fixedConfigurations,
    },
  };
};

// Default chunk size used when a caller does not supply a positive limit.
// Mirrors the initial paging size (showPageLimitationL ?? 20) decided at the call site.
const DEFAULT_SEARCH_CHUNK_SIZE = 20;

// Configuration carried in the infinite-scroll SWR key.
// offset (derived per page) and limit (= chunkSize) are excluded on purpose.
type ISearchInfiniteConfigurations = Omit<
  ISearchConfigurationsFixed,
  'offset' | 'limit'
>;

/**
 * Pure key generator for the infinite-scroll search fetch.
 *
 * Uses the '/search/infinite' namespace so it never collides with useSWRxSearch ('/search').
 * Returns null (stops fetching) when the keyword is empty, or when the previous page
 * returned fewer items than the chunk size (end of results reached).
 */
export const getSearchInfiniteKey = (
  pageIndex: number,
  previousPageData: IFormattedSearchResult | null,
  keyword: string | null,
  chunkSize: number,
  configurations: ISearchInfiniteConfigurations,
):
  | readonly ['/search/infinite', string, number, ISearchInfiniteConfigurations]
  | null => {
  if (keyword == null || keyword.length === 0) {
    return null;
  }

  // Stop once the previous page is shorter than a full chunk (no more results).
  if (previousPageData != null && previousPageData.data.length < chunkSize) {
    return null;
  }

  const offset = pageIndex * chunkSize;
  return ['/search/infinite', keyword, offset, configurations] as const;
};

export const useSWRINFxSearch = (
  keyword: string | null,
  nqName: string | null,
  configurations: Omit<ISearchConfigurations, 'offset'>,
): SWRInfiniteResponse<IFormattedSearchResult, Error> => {
  const { limit, sort, order, includeTrashPages, includeUserPages } =
    configurations;

  // Chunk size is fixed for the whole search session (no user-facing selector).
  const chunkSize = limit > 0 ? limit : DEFAULT_SEARCH_CHUNK_SIZE;

  const fixedConfigurations: ISearchInfiniteConfigurations = {
    sort: sort ?? SORT_AXIS.RELATION_SCORE,
    order: order ?? SORT_ORDER.DESC,
    includeTrashPages: includeTrashPages ?? false,
    includeUserPages: includeUserPages ?? false,
  };

  const rawQuery = createSearchQuery(
    keyword ?? '',
    fixedConfigurations.includeTrashPages,
    fixedConfigurations.includeUserPages,
  );

  return useSWRInfinite(
    (pageIndex, previousPageData: IFormattedSearchResult | null) =>
      getSearchInfiniteKey(
        pageIndex,
        previousPageData,
        keyword,
        chunkSize,
        fixedConfigurations,
      ),
    ([, , offset]) => {
      // The key head ('/search/infinite') is only a cache namespace;
      // the actual apiv1 endpoint is '/search' (shared with useSWRxSearch).
      return apiGet('/search', {
        q: encodeURIComponent(rawQuery),
        nq: typeof nqName === 'string' ? encodeURIComponent(nqName) : null,
        limit: chunkSize,
        offset,
        sort: fixedConfigurations.sort,
        order: fixedConfigurations.order,
      }).then((result) => result as IFormattedSearchResult);
    },
    {
      revalidateFirstPage: false,
    },
  );
};
