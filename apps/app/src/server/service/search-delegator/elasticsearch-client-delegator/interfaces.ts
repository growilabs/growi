import type { ES8ClientDelegator } from './es8-client-delegator';
import type { ES9ClientDelegator } from './es9-client-delegator';

// Re-export search query types from the cycle-free types file
export type {
  ES8SearchQuery,
  ES9SearchQuery,
  SearchQuery,
} from './search-types';

export type ElasticsearchClientDelegator =
  | ES8ClientDelegator
  | ES9ClientDelegator;

// type guard
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
