import type { estypes as ES8types } from '@elastic/elasticsearch8';
import type { estypes as ES9types } from '@elastic/elasticsearch9';

import {
  type ElasticsearchClientDelegator,
  isES8ClientDelegator,
  isES9ClientDelegator,
} from '~/server/service/search-delegator/elasticsearch-client-delegator';

/**
 * Sends a search request with top-level parameters (`query`, `size`,
 * `highlight`, ...), a shape both the v8 and the v9 clients accept.
 */
export const searchWithTopLevelParams = (
  client: ElasticsearchClientDelegator,
  params: Record<string, unknown>,
): Promise<unknown> => {
  if (isES8ClientDelegator(client)) {
    return client.search(params as ES8types.SearchRequest);
  }
  if (isES9ClientDelegator(client)) {
    return client.search(params as ES9types.SearchRequest);
  }
  throw new Error('Unsupported Elasticsearch version');
};
