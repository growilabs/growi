/**
 * Attachment-specific operations added on top of the existing ElasticsearchDelegator
 * via composition. This class owns the lifecycle and query building for the `attachments`
 * index and does NOT touch any Page-related index operations.
 *
 * Key design constraints:
 * - NO permission fields (grant / granted_users / granted_groups / creator) are stored in
 *   attachment ES documents — permissions are resolved at query time from page_index.
 * - Document IDs follow the pattern `${attachmentId}_${pageNumber ?? 0}`.
 * - When `targetIndexes` contains multiple indices, all writes happen in ONE `_bulk` call.
 */

import type { IAttachmentEsDoc } from '~/features/search-attachments/interfaces/attachment-search';
import type { ElasticsearchClientDelegator } from '~/server/service/search-delegator/elasticsearch-client-delegator';
import {
  isES7ClientDelegator,
  isES8ClientDelegator,
  isES9ClientDelegator,
} from '~/server/service/search-delegator/elasticsearch-client-delegator';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:service:search-attachments:delegator-extension',
);

/** Default name of the attachments ES index. */
export const DEFAULT_ATTACHMENT_INDEX_NAME = 'attachments';

/** Alias name for the live attachments index (= <indexName>-alias). */
export const attachmentAliasName = (indexName: string): string =>
  `${indexName}-alias`;

/** Options accepted by `searchAttachmentsBody` and `searchAttachmentsByPageIdsBody`. */
export type SearchOptions = {
  readonly size?: number;
  readonly from?: number;
  readonly highlight?: boolean;
};

/**
 * Highlight configuration injected into ES search bodies when `highlight: true`.
 * Uses the same `<em>` tag format as the existing Page search.
 */
const HIGHLIGHT_CONFIG = {
  pre_tags: ["<em class='highlighted-keyword'>"],
  post_tags: ['</em>'],
  fields: {
    content: { fragment_size: 150, number_of_fragments: 3 },
    'content.ja': { fragment_size: 150, number_of_fragments: 3 },
    'content.en': { fragment_size: 150, number_of_fragments: 3 },
    fileName: { number_of_fragments: 0 },
    originalName: { number_of_fragments: 0 },
  },
};

/** Default page size used when `size` is not provided. */
const DEFAULT_SIZE = 20;
/** Default offset used when `from` is not provided. */
const DEFAULT_FROM = 0;
/**
 * Maximum number of page IDs that may be passed to `searchAttachmentsByPageIdsBody`.
 * This equals one page of primary results; callers must enforce this constraint.
 */
export const MAX_PAGE_IDS_FOR_SECONDARY = DEFAULT_SIZE;

/** Interface that the delegator extension exposes to higher-level services. */
export interface AttachmentIndexOperations {
  createAttachmentIndex(indexName?: string): Promise<void>;
  syncAttachmentIndexed(
    attachmentId: string,
    pageId: string,
    docs: IAttachmentEsDoc[],
    targetIndexes: string[],
  ): Promise<void>;
  syncAttachmentRemoved(
    attachmentId: string,
    targetIndexes: string[],
  ): Promise<void>;
  searchAttachmentsBody(
    query: string,
    options: SearchOptions,
  ): Record<string, unknown>;
  searchAttachmentsByPageIdsBody(
    query: string,
    pageIds: string[],
    options?: SearchOptions,
  ): Record<string, unknown>;
  mgetPagesForPermissionBody(pageIds: string[]): Record<string, unknown>;
  /**
   * Bulk-write stub for task 4.1. The full implementation (MongoDB cursor walk +
   * text extraction) is provided by AttachmentReindexBatch (task 6.3), which
   * calls `syncAttachmentIndexed` for each attachment after extraction.
   *
   * This method is a no-op placeholder: real callers use `syncAttachmentIndexed` directly.
   */
  addAllAttachments(
    targetIndex: string,
    progress: (processed: number, total: number) => void,
  ): Promise<void>;
  /**
   * Initializes the attachments index and alias, with alias collision detection.
   *
   * Returns `{ initialized: true }` on success, or
   * `{ initialized: false, reason: 'alias_conflict' }` when the `attachments`
   * alias is found to point to a foreign (non-owned) index.
   */
  initializeAttachmentIndex(): Promise<{
    initialized: boolean;
    reason?: string;
  }>;
}

/**
 * Computes the ES document ID for an attachment page.
 * Pattern: `${attachmentId}_${pageNumber ?? 0}`
 */
const buildDocId = (attachmentId: string, pageNumber: number | null): string =>
  `${attachmentId}_${pageNumber ?? 0}`;

/**
 * Builds the multi_match content query used by both primary and secondary search.
 * Returns a bool query clause that matches content, fileName, and originalName fields.
 * Intentionally contains NO permission-related filters.
 */
const buildContentMatchClause = (query: string): Record<string, unknown> => ({
  multi_match: {
    query,
    type: 'most_fields',
    fields: [
      'content^2',
      'content.ja',
      'content.en',
      'fileName',
      'originalName',
    ],
  },
});

/**
 * Composes the full ES request body for an attachments-index search.
 * Pure function — no side effects, safe to call from any context.
 */
const composeAttachmentSearchBody = (
  query: string,
  options: SearchOptions,
  additionalFilter?: Record<string, unknown>,
): Record<string, unknown> => {
  const {
    size = DEFAULT_SIZE,
    from = DEFAULT_FROM,
    highlight = false,
  } = options;

  const mustClauses: Record<string, unknown>[] = [
    buildContentMatchClause(query),
  ];

  const body: Record<string, unknown> = {
    query: {
      bool: {
        must: mustClauses,
        ...(additionalFilter != null ? { filter: [additionalFilter] } : {}),
      },
    },
    size,
    from,
  };

  if (highlight) {
    body.highlight = HIGHLIGHT_CONFIG;
  }

  return body;
};

/**
 * Performs a deleteByQuery for one index using the appropriate ES version API.
 * Returns a settled result so callers can handle partial failures without throwing.
 */
const deleteByQueryForIndex = (
  client: ElasticsearchClientDelegator,
  indexName: string,
  attachmentId: string,
): Promise<unknown> => {
  const deleteQuery = { term: { attachmentId } };

  if (isES7ClientDelegator(client)) {
    return client.deleteByQuery({
      index: indexName,
      body: { query: deleteQuery },
      conflicts: 'proceed',
    });
  }
  if (isES8ClientDelegator(client)) {
    return client.deleteByQuery({
      index: indexName,
      query: deleteQuery,
      conflicts: 'proceed',
    });
  }
  if (isES9ClientDelegator(client)) {
    return client.deleteByQuery({
      index: indexName,
      query: deleteQuery,
      conflicts: 'proceed',
    });
  }
  return Promise.reject(new Error('Unsupported Elasticsearch version'));
};

/**
 * AttachmentSearchDelegatorExtension wraps an existing ElasticsearchClientDelegator
 * and adds attachment-specific index operations via composition.
 *
 * Thread safety: this class is stateless beyond the injected `client` reference;
 * all methods are safe for concurrent invocation.
 */
export class AttachmentSearchDelegatorExtension
  implements AttachmentIndexOperations
{
  constructor(private readonly client: ElasticsearchClientDelegator) {}

  // ----------------------------------------------------------------
  // Index lifecycle
  // ----------------------------------------------------------------

  async createAttachmentIndex(
    indexName: string = DEFAULT_ATTACHMENT_INDEX_NAME,
  ): Promise<void> {
    if (isES7ClientDelegator(this.client)) {
      const { mappings } = await import(
        '~/features/search-attachments/server/mappings/attachments-mappings-es7'
      );
      await this.client.indices.create({
        index: indexName,
        body: { ...mappings },
      });
      return;
    }

    if (isES8ClientDelegator(this.client)) {
      const { mappings } = await import(
        '~/features/search-attachments/server/mappings/attachments-mappings-es8'
      );
      await this.client.indices.create({
        index: indexName,
        ...mappings,
      });
      return;
    }

    if (isES9ClientDelegator(this.client)) {
      const { mappings } = await import(
        '~/features/search-attachments/server/mappings/attachments-mappings-es9'
      );
      await this.client.indices.create({
        index: indexName,
        ...mappings,
      });
      return;
    }

    throw new Error('Unsupported Elasticsearch version');
  }

  /**
   * The set of index names owned by this feature module.
   * An alias that points to any index outside this set is considered a collision.
   */
  private static readonly OWNED_INDEX_NAMES = [
    'attachments',
    'attachments-tmp',
  ] as const;

  /**
   * Initializes the `attachments` index and alias, guarded by alias collision detection.
   *
   * Algorithm:
   * 1. Query ES for any alias named `attachments`.
   *    - If ES returns 404, the alias does not exist → safe to proceed.
   * 2. For each index that carries the alias, verify it belongs to this spec.
   *    - If any index is NOT in OWNED_INDEX_NAMES, emit WARN and abort.
   * 3. Ensure the `attachments` index exists (create if absent).
   * 4. Ensure the alias `attachments` points to the `attachments` index.
   * 5. Return `{ initialized: true }`.
   */
  async initializeAttachmentIndex(): Promise<{
    initialized: boolean;
    reason?: string;
  }> {
    const aliasName = DEFAULT_ATTACHMENT_INDEX_NAME; // 'attachments'
    const indexName = DEFAULT_ATTACHMENT_INDEX_NAME; // 'attachments'

    // Step 1: Check for alias collision
    let aliasInfo: Record<string, unknown> | null = null;
    try {
      aliasInfo = (await this.client.indices.getAlias({
        name: aliasName,
      })) as Record<string, unknown>;
    } catch (err) {
      // ES returns 404 when alias does not exist — treat as "alias absent, proceed"
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode !== 404) {
        // Unexpected error: rethrow
        throw err;
      }
    }

    // Step 2: Collision detection
    if (aliasInfo != null) {
      for (const owningIndexName of Object.keys(aliasInfo)) {
        if (
          !(
            AttachmentSearchDelegatorExtension.OWNED_INDEX_NAMES as readonly string[]
          ).includes(owningIndexName)
        ) {
          logger.warn(
            { foreignIndex: owningIndexName },
            "'attachments' alias points to a foreign index — skipping attachment index initialization to prevent data corruption",
          );
          return { initialized: false, reason: 'alias_conflict' };
        }
      }
    }

    // Step 3: Ensure the index exists
    const isExistsIndex = await this.client.indices.exists({
      index: indexName,
    });
    if (!isExistsIndex) {
      await this.createAttachmentIndex(indexName);
    }

    // Step 4: Ensure the alias points to the index
    const isExistsAlias = await this.client.indices.existsAlias({
      name: aliasName,
      index: indexName,
    });
    if (!isExistsAlias) {
      await this.client.indices.putAlias({
        name: aliasName,
        index: indexName,
      });
    }

    return { initialized: true };
  }

  // ----------------------------------------------------------------
  // Document write operations
  // ----------------------------------------------------------------

  /**
   * Bulk-upserts the extracted attachment pages into every index in `targetIndexes`.
   * All writes are issued as a single `_bulk` API call to minimise round-trips.
   *
   * Idempotent: calling twice with the same arguments overwrites the previous docs
   * because the doc ID is deterministic (`${attachmentId}_${pageNumber ?? 0}`).
   */
  async syncAttachmentIndexed(
    attachmentId: string,
    pageId: string,
    docs: IAttachmentEsDoc[],
    targetIndexes: string[],
  ): Promise<void> {
    if (targetIndexes.length === 0 || docs.length === 0) {
      return;
    }

    // Build a flat array of alternating [index-action, document] pairs for every
    // (index, doc) combination. ES _bulk requires this interleaved format.
    // biome-ignore lint/suspicious/noExplicitAny: Bulk operations are polymorphic across ES versions
    const operations: any[] = [];

    for (const indexName of targetIndexes) {
      for (const doc of docs) {
        const docId = buildDocId(attachmentId, doc.pageNumber);

        // Index (upsert) action header
        operations.push({ index: { _index: indexName, _id: docId } });

        // Document body — NO permission fields
        operations.push({
          attachmentId: doc.attachmentId,
          pageId: doc.pageId,
          pageNumber: doc.pageNumber,
          label: doc.label,
          fileName: doc.fileName,
          originalName: doc.originalName,
          fileFormat: doc.fileFormat,
          fileSize: doc.fileSize,
          attachmentType: doc.attachmentType,
          content: doc.content,
          created_at: doc.created_at,
          updated_at: doc.updated_at,
        });
      }
    }

    // ES7 uses `body`, ES8/ES9 use `operations` in BulkRequest.
    // We must call bulk through the narrowed type guard so TypeScript resolves the correct overload.
    let response: {
      errors: boolean;
      items?: Array<{ index?: { error?: unknown } }>;
    };

    if (isES7ClientDelegator(this.client)) {
      response = await this.client.bulk({ body: operations });
    } else if (isES8ClientDelegator(this.client)) {
      response = await this.client.bulk({ operations });
    } else if (isES9ClientDelegator(this.client)) {
      response = await this.client.bulk({ operations });
    } else {
      throw new Error('Unsupported Elasticsearch version');
    }

    if (response.errors) {
      const failedItems = (response.items ?? []).filter(
        (item) => item.index?.error != null,
      );
      logger.error(
        { attachmentId, pageId, failedItems },
        'syncAttachmentIndexed: bulk write reported errors',
      );
    } else {
      logger.debug(
        {
          attachmentId,
          pageId,
          docCount: docs.length,
          indexCount: targetIndexes.length,
        },
        'syncAttachmentIndexed: bulk write succeeded',
      );
    }
  }

  /**
   * Removes all ES documents for the given `attachmentId` from each target index.
   * Uses `deleteByQuery` to cover all page-number variants without knowing them in advance.
   *
   * Failures on individual indexes are logged and swallowed so that a failure on
   * `attachments-tmp` does not block removal from the live `attachments` index.
   */
  async syncAttachmentRemoved(
    attachmentId: string,
    targetIndexes: string[],
  ): Promise<void> {
    if (targetIndexes.length === 0) {
      return;
    }

    // Run deleteByQuery for all target indexes concurrently.
    const results = await Promise.allSettled(
      targetIndexes.map((indexName) =>
        deleteByQueryForIndex(this.client, indexName, attachmentId),
      ),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const indexName = targetIndexes[i];
      if (result.status === 'rejected') {
        logger.error(
          { attachmentId, indexName, err: result.reason },
          'syncAttachmentRemoved: deleteByQuery failed',
        );
      } else {
        logger.debug(
          { attachmentId, indexName },
          'syncAttachmentRemoved: deleteByQuery succeeded',
        );
      }
    }
  }

  // ----------------------------------------------------------------
  // Query body builders (pure — no ES calls)
  // ----------------------------------------------------------------

  /**
   * Builds the ES request body for an attachments-index content search.
   * No permission filter is included; callers must handle access control separately.
   *
   * Used by:
   * - primary search (facet=attachments)
   * - parallel msearch (facet=all, page 1)
   */
  searchAttachmentsBody(
    query: string,
    options: SearchOptions,
  ): Record<string, unknown> {
    return composeAttachmentSearchBody(query, options);
  }

  /**
   * Builds the ES request body for secondary enrichment — restricts results to docs
   * whose `pageId` is in `pageIds` (already viewer-permission-checked by the primary).
   *
   * Callers MUST ensure `pageIds.length <= MAX_PAGE_IDS_FOR_SECONDARY` to prevent
   * unbounded terms queries.
   */
  searchAttachmentsByPageIdsBody(
    query: string,
    pageIds: string[],
    options: SearchOptions = {},
  ): Record<string, unknown> {
    return composeAttachmentSearchBody(query, options, {
      terms: { pageId: pageIds },
    });
  }

  /**
   * Builds the mget request body for fetching page permission fields from page_index.
   * Only the minimum set of fields required for viewer permission resolution is fetched;
   * the page body (revision content) is intentionally excluded.
   *
   * Used by: `AttachmentSearchResultAggregator` when `facet=attachments` primary needs
   * to determine which parent pages the current viewer may access.
   */
  mgetPagesForPermissionBody(pageIds: string[]): Record<string, unknown> {
    return {
      ids: pageIds,
      _source_includes: [
        '_id',
        'grant',
        'grantedUsers',
        'grantedGroups',
        'creator',
        'path',
        'title',
        'updatedAt',
      ],
    };
  }

  // ----------------------------------------------------------------
  // Bulk reindex (stub — real implementation in AttachmentReindexBatch, task 6.3)
  // ----------------------------------------------------------------

  /**
   * Stub implementation for the delegator-level addAllAttachments interface.
   *
   * The full MongoDB cursor walk + text extraction orchestration lives in
   * `AttachmentReindexBatch.addAllAttachments` (task 6.3), which in turn calls
   * `syncAttachmentIndexed` on this class for each extracted attachment.
   *
   * This stub exists to satisfy the `AttachmentIndexOperations` contract and to allow
   * future callers (test doubles, stubs) to reference the method by name without
   * depending on the batch class.
   */
  addAllAttachments(
    _targetIndex: string,
    _progress: (processed: number, total: number) => void,
  ): Promise<void> {
    // Implementation provided by AttachmentReindexBatch (task 6.3).
    logger.warn(
      'addAllAttachments called on delegator extension — this is a stub. Use AttachmentReindexBatch instead.',
    );
    return Promise.resolve();
  }
}
