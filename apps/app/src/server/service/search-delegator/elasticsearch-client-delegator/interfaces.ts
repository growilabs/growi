import type { estypes as ES7types, RequestParams } from '@elastic/elasticsearch7';
import type { estypes as ES8types } from '@elastic/elasticsearch8';
import type { estypes as ES9types } from '@elastic/elasticsearch9';

import type { ES7ClientDelegator } from './es7-client-delegator';
import type { ES8ClientDelegator } from './es8-client-delegator';
import type { ES9ClientDelegator } from './es9-client-delegator';

export type ElasticsearchClientDelegator = ES7ClientDelegator | ES8ClientDelegator | ES9ClientDelegator;


// type guard
// TODO: https://redmine.weseek.co.jp/issues/168446
export const isES7ClientDelegator = (delegator: ElasticsearchClientDelegator): delegator is ES7ClientDelegator => {
  return delegator.delegatorVersion === 7;
};

export const isES8ClientDelegator = (delegator: ElasticsearchClientDelegator): delegator is ES8ClientDelegator => {
  return delegator.delegatorVersion === 8;
};

export const isES9ClientDelegator = (delegator: ElasticsearchClientDelegator): delegator is ES9ClientDelegator => {
  return delegator.delegatorVersion === 9;
};


// Official library-derived interface
// TODO: https://redmine.weseek.co.jp/issues/168446
export type ES7SearchQuery = RequestParams.Search<{
  query: ES7types.QueryDslQueryContainer
  sort?: ES7types.Sort
  highlight?: ES7types.SearchHighlight
}>

export interface ES8SearchQuery {
  index: ES8types.IndexName
  _source: ES8types.Fields
  from?: number;
  size?: number;
  body: {
    query: ES8types.QueryDslQueryContainer;
    sort?: ES8types.Sort
    highlight?: ES8types.SearchHighlight;
  };
}

export interface ES9SearchQuery {
  index: ES9types.IndexName
  _source: ES9types.Fields
  from?: number;
  size?: number;
  body: {
    query: ES9types.QueryDslQueryContainer;
    sort?: ES9types.Sort
    highlight?: ES9types.SearchHighlight;
  };
}

export type SearchQuery = ES7SearchQuery | ES8SearchQuery | ES9SearchQuery;
