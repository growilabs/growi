import { IPageHasId } from './page';

export enum CheckboxType {
  NONE_CHECKED = 'noneChecked',
  INDETERMINATE = 'indeterminate',
  ALL_CHECKED = 'allChecked',
}

export type IPageSearchResultData = {
  pageData: IPageHasId;
  pageMeta: {
    bookmarkCount?: number;
    elasticSearchResult?: {
      snippet: string;
      highlightedPath: string;
      isHtmlInPath: boolean;
    };
  };
};

export type IFormattedSearchResult = {
  data: IPageSearchResultData[]

  totalCount: number

  meta: {
    total: number
    took?: number
    count?: number
  }
}

export const SORT_AXIS = {
  RELATION_SCORE: 'relationScore',
  CREATED_AT: 'createdAt',
  UPDATED_AT: 'updatedAt',
} as const;
export type SORT_AXIS = typeof SORT_AXIS[keyof typeof SORT_AXIS];

export const SORT_ORDER = {
  DESC: 'desc',
  ASC: 'asc',
} as const;
export type SORT_ORDER = typeof SORT_ORDER[keyof typeof SORT_ORDER];
