import type { estypes as ES8types } from '@elastic/elasticsearch8';
import type { estypes as ES9types } from '@elastic/elasticsearch9';

// Search query types kept in a dedicated type-only file, separate from the
// delegator classes in interfaces.ts.
// This file must stay type-only and must not import from the delegator files.

export interface ES8SearchQuery {
  index: ES8types.IndexName;
  _source: ES8types.Fields;
  from?: number;
  size?: number;
  body: {
    query: ES8types.QueryDslQueryContainer;
    sort?: ES8types.Sort;
    highlight?: ES8types.SearchHighlight;
  };
}

export interface ES9SearchQuery {
  index: ES9types.IndexName;
  _source: ES9types.Fields;
  from?: number;
  size?: number;
  body: {
    query: ES9types.QueryDslQueryContainer;
    sort?: ES9types.Sort;
    highlight?: ES9types.SearchHighlight;
  };
}

export type SearchQuery = ES8SearchQuery | ES9SearchQuery;
