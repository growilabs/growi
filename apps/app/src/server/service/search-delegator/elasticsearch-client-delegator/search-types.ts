import type {
  estypes as ES7types,
  RequestParams,
} from '@elastic/elasticsearch7';
import type { estypes as ES8types } from '@elastic/elasticsearch8';
import type { estypes as ES9types } from '@elastic/elasticsearch9';

// Search query types extracted from interfaces.ts to break the
// es7-client-delegator.ts <-> interfaces.ts import cycle.
// This file must stay type-only and must not import from the delegator files.

// Official library-derived interface
// TODO: https://redmine.weseek.co.jp/issues/168446
export type ES7SearchQuery = RequestParams.Search<{
  query: ES7types.QueryDslQueryContainer;
  sort?: ES7types.Sort;
  highlight?: ES7types.SearchHighlight;
  aggs?: Record<string, ES7types.AggregationsAggregationContainer>;
  size?: number;
}>;

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

export type SearchQuery = ES7SearchQuery | ES8SearchQuery | ES9SearchQuery;
