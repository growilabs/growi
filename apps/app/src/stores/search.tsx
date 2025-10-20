import type { SWRResponse } from 'swr';
import useSWR, { mutate } from 'swr';

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

      return apiGet(
        endpoint,
        {
          q: encodeURIComponent(rawQuery),
          nq: typeof nqName === 'string' ? encodeURIComponent(nqName) : null,
          limit,
          offset,
          sort,
          order,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ).then((result) => result as IFormattedSearchResult);
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
