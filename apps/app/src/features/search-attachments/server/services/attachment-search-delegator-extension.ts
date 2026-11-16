/**
 * Attachment-specific operations added on top of the existing ElasticsearchDelegator
 * via composition. This class owns the lifecycle and query building for the attachment
 * indices and does NOT touch any Page-related index operations.
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
  isES8ClientDelegator,
  isES9ClientDelegator,
} from '~/server/service/search-delegator/elasticsearch-client-delegator';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:service:search-attachments:delegator-extension',
);

export type AttachmentIndexNames = {
  /** Every read and live write goes through this alias. */
  readonly alias: string;
  /**
   * The alias points to one of these; a rebuild fills the other and then
   * moves the alias, so the live index stays untouched until the swap.
   */
  readonly indices: readonly [string, string];
};

/**
 * Derived from the page index name, which comes from the Elasticsearch URI
 * path, so GROWI apps sharing one Elasticsearch do not collide.
 */
export const attachmentIndexNames = (
  pageIndexName: string,
): AttachmentIndexNames => ({
  alias: `${pageIndexName}-attachments-alias`,
  indices: [`${pageIndexName}-attachments-1`, `${pageIndexName}-attachments-2`],
});

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
  /** Every read and live write goes through this alias. */
  readonly aliasName: string;
  /** Creates the first index behind the alias unless the alias already exists. */
  ensureAttachmentIndex(): Promise<void>;
  /** Creates a fresh index the alias does not point to, and returns its name. */
  createRebuildIndex(): Promise<string>;
  /** Moves the alias to `index` and deletes the index it pointed to before. */
  swapAttachmentAlias(index: string): Promise<void>;
  /** Deletes `index` unless the alias points to it. */
  dropRebuildIndex(index: string): Promise<void>;
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

  if (isES8ClientDelegator(client)) {
    return client.deleteByQuery({
      index: indexName,
      query: deleteQuery,
      conflicts: 'proceed',
      // The index does not exist until something has been indexed
      ignore_unavailable: true,
    });
  }
  if (isES9ClientDelegator(client)) {
    return client.deleteByQuery({
      index: indexName,
      query: deleteQuery,
      conflicts: 'proceed',
      // The index does not exist until something has been indexed
      ignore_unavailable: true,
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
  private readonly client: ElasticsearchClientDelegator;

  private readonly names: AttachmentIndexNames;

  constructor(
    client: ElasticsearchClientDelegator,
    names: AttachmentIndexNames,
  ) {
    this.client = client;
    this.names = names;
  }

  get aliasName(): string {
    return this.names.alias;
  }

  // ----------------------------------------------------------------
  // Index lifecycle
  // ----------------------------------------------------------------

  async createAttachmentIndex(indexName: string): Promise<void> {
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

  /** The index the alias points to, or null when the alias does not exist. */
  private async findLiveIndex(): Promise<string | null> {
    const { alias } = this.names;
    if (!(await this.client.indices.existsAlias({ name: alias }))) {
      return null;
    }
    const aliasInfo = await this.client.indices.getAlias({ name: alias });
    return Object.keys(aliasInfo)[0] ?? null;
  }

  async ensureAttachmentIndex(): Promise<void> {
    if ((await this.findLiveIndex()) != null) {
      return;
    }
    const [index] = this.names.indices;
    if (!(await this.client.indices.exists({ index }))) {
      await this.createAttachmentIndex(index);
    }
    await this.client.indices.putAlias({ name: this.names.alias, index });
  }

  async createRebuildIndex(): Promise<string> {
    const live = await this.findLiveIndex();
    const [first, second] = this.names.indices;
    const index = live === first ? second : first;
    // Left over by an interrupted rebuild
    if (await this.client.indices.exists({ index })) {
      await this.client.indices.delete({ index });
    }
    await this.createAttachmentIndex(index);
    return index;
  }

  async swapAttachmentAlias(index: string): Promise<void> {
    const { alias } = this.names;
    const previous = await this.findLiveIndex();
    const isMoving = previous != null && previous !== index;
    await this.client.indices.updateAliases({
      actions: [
        { add: { alias, index } },
        ...(isMoving ? [{ remove: { alias, index: previous } }] : []),
      ],
    });
    if (isMoving) {
      try {
        await this.client.indices.delete({ index: previous });
      } catch (err) {
        // The swap itself succeeded; the next rebuild drops this index
        logger.warn(
          { err, index: previous },
          'Failed to delete the previous attachment index',
        );
      }
    }
  }

  async dropRebuildIndex(index: string): Promise<void> {
    if ((await this.findLiveIndex()) === index) {
      return;
    }
    if (await this.client.indices.exists({ index })) {
      await this.client.indices.delete({ index });
    }
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
        operations.push({
          index: {
            _index: indexName,
            _id: docId,
            // Never let a write auto-create a concrete index named like the alias
            ...(indexName === this.names.alias ? { require_alias: true } : {}),
          },
        });

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

    // Call bulk through the narrowed type guard so TypeScript resolves the correct overload.
    let response: {
      errors: boolean;
      items?: Array<{ index?: { error?: unknown } }>;
    };

    if (isES8ClientDelegator(this.client)) {
      response = await this.client.bulk({ operations });
    } else if (isES9ClientDelegator(this.client)) {
      response = await this.client.bulk({ operations });
    } else {
      throw new Error('Unsupported Elasticsearch version');
    }

    // Rejected so callers handle it like any other ES failure
    if (response.errors) {
      const failedItems = (response.items ?? []).filter(
        (item) => item.index?.error != null,
      );
      throw new Error(
        `Bulk write of attachment ${attachmentId} (page ${pageId}) failed: ${JSON.stringify(
          failedItems.map((item) => item.index?.error),
        )}`,
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
}
