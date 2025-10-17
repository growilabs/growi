import type { IDataWithMeta, IPageHasId } from '@growi/core';

export type IPageSearchMeta = {
  bookmarkCount?: number;
  elasticSearchResult?: {
    snippet?: string | null;
    highlightedPath?: string | null;
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isIPageSearchMeta = (meta: any): meta is IPageSearchMeta => {
  return meta != null && 'elasticSearchResult' in meta;
};

export type ISearchResultMeta = {
  meta: {
    took?: number;
    total: number;
    hitsCount: number;
  };
};

export type ISearchResultData = {
  _id: string;
  _score: number;
  _source: any;
  _highlight: any;
};

export type ISearchResult<T> = ISearchResultMeta & {
  data: T[];
};

export type IPageWithSearchMeta = IDataWithMeta<IPageHasId, IPageSearchMeta>;

export type IFormattedSearchResult = ISearchResultMeta & {
  data: IPageWithSearchMeta[];
};

export const SORT_AXIS = {
  RELATION_SCORE: 'relationScore',
  CREATED_AT: 'createdAt',
  UPDATED_AT: 'updatedAt',
} as const;
export type SORT_AXIS = (typeof SORT_AXIS)[keyof typeof SORT_AXIS];

export const SORT_ORDER = {
  DESC: 'desc',
  ASC: 'asc',
} as const;
export type SORT_ORDER = (typeof SORT_ORDER)[keyof typeof SORT_ORDER];
