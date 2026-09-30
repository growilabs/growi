import type { ElasticsearchClientDelegator } from './elasticsearch-client-delegator';
import {
  isES8ClientDelegator,
  isES9ClientDelegator,
} from './elasticsearch-client-delegator';
import type { ES8ClientDelegator } from './elasticsearch-client-delegator/es8-client-delegator';
import type { ES9ClientDelegator } from './elasticsearch-client-delegator/es9-client-delegator';

// Syncing a new field to the auditlog index takes four coordinated changes:
//   1. this type,
//   2. prepareBodyForAuditlog() in elasticsearch.ts, which reads it off the activity,
//   3. the .select() in addAllAuditlogs() — omitting it makes the field appear
//      in live sync but vanish after a rebuild,
//   4. mappings/mappings-auditlog-properties.ts, so it is not dynamically mapped.
// Also confirm the field is immutable after creation; see the 'update' note in
// auditlog-changestream.ts.
export type AuditlogSyncFields = Partial<{
  username: string;
  endpoint: string;
}>;

/**
 * Dispatch to the ES8- or ES9-specific handler for `client`, throwing the
 * same "unsupported version" error both `createAuditlogIndex` and
 * `syncAuditlogMapping` need. Keeps the version-dispatch skeleton in one place
 * so the two call sites cannot drift out of sync with each other.
 */
export const runForAuditlogClient = async <T>(
  client: ElasticsearchClientDelegator,
  elasticsearchVersion: 8 | 9,
  handlers: {
    es8: (client: ES8ClientDelegator) => Promise<T>;
    es9: (client: ES9ClientDelegator) => Promise<T>;
  },
): Promise<T> => {
  if (isES8ClientDelegator(client)) {
    return handlers.es8(client);
  }
  if (isES9ClientDelegator(client)) {
    return handlers.es9(client);
  }
  throw new Error(`Unsupported Elasticsearch version: ${elasticsearchVersion}`);
};

export const createAuditlogIndex = (
  client: ElasticsearchClientDelegator,
  elasticsearchVersion: 8 | 9,
  index: string,
): Promise<
  Awaited<ReturnType<ElasticsearchClientDelegator['indices']['create']>>
> => {
  return runForAuditlogClient(client, elasticsearchVersion, {
    es8: async (es8Client) => {
      const { mappings } = await import('./mappings/mappings-auditlog-es8');
      return es8Client.indices.create({ index, ...mappings });
    },
    es9: async (es9Client) => {
      const { mappings } = await import('./mappings/mappings-auditlog-es9');
      return es9Client.indices.create({ index, ...mappings });
    },
  });
};

/**
 * Push the current auditlog mapping onto an index that already exists.
 *
 * The index is created once and never re-created on upgrade, so a field added
 * to the mapping would otherwise only reach fresh installs — on an upgraded
 * instance Elasticsearch would dynamically map it as `text` and break the
 * `keyword` aggregations it was added for. Adding a field is a compatible
 * mapping update; changing an existing field's type is not, and Elasticsearch
 * rejects it — the boot and rebuild paths log such a failure instead of aborting.
 */
export const syncAuditlogMapping = async (
  client: ElasticsearchClientDelegator,
  elasticsearchVersion: 8 | 9,
  index: string,
): Promise<void> => {
  await runForAuditlogClient(client, elasticsearchVersion, {
    es8: async (es8Client) => {
      const { mappings } = await import('./mappings/mappings-auditlog-es8');
      return es8Client.indices.putMapping({ index, ...mappings.mappings });
    },
    es9: async (es9Client) => {
      const { mappings } = await import('./mappings/mappings-auditlog-es9');
      return es9Client.indices.putMapping({ index, ...mappings.mappings });
    },
  });
};
