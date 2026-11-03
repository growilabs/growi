import type {
  IDataWithMeta,
  IDataWithRequiredMeta,
  IPageHasId,
} from '@growi/core';

import type { IAttachmentHit } from '~/features/search-attachments/interfaces/attachment-search';

export type IPageSearchMeta = {
  bookmarkCount?: number;
  elasticSearchResult?: {
    snippet?: string | null;
    highlightedPath?: string | null;
  };
  attachmentHits?: IAttachmentHit[];
};

export const isIPageSearchMeta = (meta: any): meta is IPageSearchMeta => {
  return meta != null && 'elasticSearchResult' in meta;
};

export type ISearchResultMeta = {
  took?: number;
  total: number;
  hitsCount: number;
};

export type ISearchResultData = {
  _id: string;
  _score: number;
  _source: any;
  _highlight: any;
};

export type ISearchResult<T> = IDataWithRequiredMeta<T[], ISearchResultMeta>;

export type IPageWithSearchMeta = IDataWithMeta<IPageHasId, IPageSearchMeta>;

export type IFormattedSearchResult = IDataWithRequiredMeta<
  IPageWithSearchMeta[],
  ISearchResultMeta
>;

export type SearchFacet = 'all' | 'pages' | 'attachments';

export type IFacetedSearchResultMeta = {
  facet: SearchFacet;
  /** null for facet=attachments: a count would include hits the viewer cannot see */
  total: number | null;
  hitsCount: number;
  /** true only when the attachment search or its permission lookup failed */
  primaryResultIncomplete?: boolean;
  nextCursor?: string;
};

/**
 * `GET /_api/search` body for `facet=all|attachments` while attachment search
 * is enabled. Every other request (no `facet`, `facet=pages`, feature
 * disabled, `nq`) keeps answering IFormattedSearchResult, so existing clients
 * never see a null total.
 */
export type IFacetedSearchResult = IDataWithRequiredMeta<
  IPageWithSearchMeta[],
  IFacetedSearchResultMeta
>;

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
