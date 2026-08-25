import type ElasticsearchDelegator from './elasticsearch';
import type { ElasticsearchClientDelegator } from './elasticsearch-client-delegator';

export const injectClient = (
  target: ElasticsearchDelegator,
  client: ElasticsearchClientDelegator,
): void => {
  (target as unknown as { client: ElasticsearchClientDelegator }).client =
    client;
};
