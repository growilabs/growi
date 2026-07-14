import type { SWRResponse } from 'swr';
import useSWR, { mutate } from 'swr';

import { apiGet } from '~/client/util/apiv1-client';
import {
  buildSearchQuery,
  createEmptyFilterState,
  type SearchFilterState,
} from '~/features/search/client/utils/search-query';
import type { IFormattedSearchResult } from '~/interfaces/search';
import { SORT_AXIS, SORT_ORDER } from '~/interfaces/search';

export type ISearchConfigurations = {
  limit: number;
  offset?: number;
  sort?: SORT_AXIS;
  order?: SORT_ORDER;
  includeTrashPages?: boolean;
  includeUserPages?: boolean;
  filters?: SearchFilterState;
};

type ISearchConfigurationsFixed = {
  limit: number;
  offset: number;
  sort: SORT_AXIS;
  order: SORT_ORDER;
  includeTrashPages: boolean;
  includeUserPages: boolean;
  filters: SearchFilterState;
};

export type ISearchConditions = ISearchConfigurationsFixed & {
  keyword: string | null;
  rawQuery: string;
};

const createSearchQuery = (
  keyword: string,
  filters: SearchFilterState,
  includeTrashPages: boolean,
  includeUserPages: boolean,
): string => {
  // Negations are appended below rather than via buildSearchQuery, which owns
  // only the positive filter operators (author/editor/group/tag), not negation.
  let query = buildSearchQuery(keyword, filters);

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
  const {
    limit,
    offset,
    sort,
    order,
    includeTrashPages,
    includeUserPages,
    filters,
  } = configurations;

  const fixedConfigurations: ISearchConfigurationsFixed = {
    limit,
    offset: offset ?? 0,
    sort: sort ?? SORT_AXIS.RELATION_SCORE,
    order: order ?? SORT_ORDER.DESC,
    includeTrashPages: includeTrashPages ?? false,
    includeUserPages: includeUserPages ?? false,
    filters: filters ?? createEmptyFilterState(),
  };
  const rawQuery = createSearchQuery(
    keyword ?? '',
    fixedConfigurations.filters,
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
