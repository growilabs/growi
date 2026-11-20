import type ElasticsearchDelegator from './elasticsearch';
import type { ElasticsearchClientDelegator } from './elasticsearch-client-delegator';

export const injectClient = (
  target: ElasticsearchDelegator,
  client: ElasticsearchClientDelegator,
): void => {
  (target as unknown as { client: ElasticsearchClientDelegator }).client =
    client;
};

export const setIndexName = (
  target: ElasticsearchDelegator,
  indexName: string,
): void => {
  (target as unknown as { indexName: string }).indexName = indexName;
};

export const getClient = (
  target: ElasticsearchDelegator,
): ElasticsearchClientDelegator =>
  (target as unknown as { client: ElasticsearchClientDelegator }).client;
