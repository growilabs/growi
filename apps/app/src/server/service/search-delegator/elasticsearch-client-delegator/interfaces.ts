import type { ES7ClientDelegator } from './es7-client-delegator';
import type { ES8ClientDelegator } from './es8-client-delegator';
import type { ES9ClientDelegator } from './es9-client-delegator';

// Re-export search query types from the cycle-free types file
export type {
  ES7SearchQuery,
  ES8SearchQuery,
  ES9SearchQuery,
  SearchQuery,
} from './search-types';

export type ElasticsearchClientDelegator =
  | ES7ClientDelegator
  | ES8ClientDelegator
  | ES9ClientDelegator;

// type guard
// TODO: https://redmine.weseek.co.jp/issues/168446
export const isES7ClientDelegator = (
  delegator: ElasticsearchClientDelegator,
): delegator is ES7ClientDelegator => {
  return delegator.delegatorVersion === 7;
};

export const isES8ClientDelegator = (
  delegator: ElasticsearchClientDelegator,
): delegator is ES8ClientDelegator => {
  return delegator.delegatorVersion === 8;
};

export const isES9ClientDelegator = (
  delegator: ElasticsearchClientDelegator,
): delegator is ES9ClientDelegator => {
  return delegator.delegatorVersion === 9;
};
