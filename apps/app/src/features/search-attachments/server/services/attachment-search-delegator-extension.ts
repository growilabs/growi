/**
 * Attachment-specific operations added on top of the existing ElasticsearchDelegator
 * via composition. This class owns the lifecycle and query building for the attachment
 * indices and does NOT touch any Page-related index operations.
 *
 * Key design constraints:
 * - NO permission fields (grant / granted_users / granted_groups / creator) are stored in
 *   attachment ES documents — permissions are resolved at query time from page_index.
 * - Document IDs follow the pattern `${attachmentId}_${pageNumber ?? 0}`.
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
  /** Deletes every doc of the given attachments from `index`, including docs written just before. */
  removeAttachmentsFromIndex(
    attachmentIds: string[],
    index: string,
  ): Promise<void>;
  syncAttachmentIndexed(
    attachmentId: string,
    pageId: string,
    docs: IAttachmentEsDoc[],
    targetIndex: string,
  ): Promise<void>;
  /** Deletes the docs of the attachment in `index` other than `currentDocs`. */
  removeStaleAttachmentDocs(
    attachmentId: string,
    currentDocs: IAttachmentEsDoc[],
    index: string,
  ): Promise<void>;
  syncAttachmentRemoved(
    attachmentId: string,
    targetIndexes: string[],
  ): Promise<void>;
}

/**
 * Computes the ES document ID for an attachment page.
 * Pattern: `${attachmentId}_${pageNumber ?? 0}`
 */
const buildDocId = (attachmentId: string, pageNumber: number | null): string =>
  `${attachmentId}_${pageNumber ?? 0}`;

/**
 * Deletes the docs matching `query` from `index`. Rejects when
 * Elasticsearch reports docs it could not delete.
 */
const deleteDocsByQuery = async (
  client: ElasticsearchClientDelegator,
  index: string,
  query: Record<string, unknown>,
): Promise<void> => {
  const params = {
    index,
    // The alias is missing while the feature has never been enabled
    ignore_unavailable: true,
  };

  // delete-by-query only sees docs made searchable by a refresh
  let failures: unknown[] | undefined;
  if (isES8ClientDelegator(client)) {
    await client.indices.refresh(params);
    ({ failures } = await client.deleteByQuery({
      ...params,
      query,
      conflicts: 'proceed',
    }));
  } else if (isES9ClientDelegator(client)) {
    await client.indices.refresh(params);
    ({ failures } = await client.deleteByQuery({
      ...params,
      query,
      conflicts: 'proceed',
    }));
  } else {
    throw new Error('Unsupported Elasticsearch version');
  }

  if (failures != null && failures.length > 0) {
    throw new Error(
      `Delete of attachments from ${index} failed: ${JSON.stringify(failures)}`,
    );
  }
};

const deleteAttachmentDocs = (
  client: ElasticsearchClientDelegator,
  index: string,
  attachmentIds: string[],
): Promise<void> =>
  deleteDocsByQuery(client, index, { terms: { attachmentId: attachmentIds } });

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
   * Bulk-upserts the extracted attachment pages into `targetIndex` in one `_bulk` call.
   *
   * Idempotent: calling twice with the same arguments overwrites the previous docs
   * because the doc ID is deterministic (`${attachmentId}_${pageNumber ?? 0}`).
   */
  async syncAttachmentIndexed(
    attachmentId: string,
    pageId: string,
    docs: IAttachmentEsDoc[],
    targetIndex: string,
  ): Promise<void> {
    if (docs.length === 0) {
      return;
    }

    // Never let a write auto-create a concrete index named like the alias
    const requireAlias =
      targetIndex === this.names.alias ? { require_alias: true } : {};

    // ES _bulk takes alternating [action, document] entries
    const operations = docs.flatMap((doc) => [
      {
        index: {
          _index: targetIndex,
          _id: buildDocId(attachmentId, doc.pageNumber),
          ...requireAlias,
        },
      },
      // NO permission fields
      {
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
      },
    ]);

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

  removeAttachmentsFromIndex(
    attachmentIds: string[],
    index: string,
  ): Promise<void> {
    return deleteAttachmentDocs(this.client, index, attachmentIds);
  }

  removeStaleAttachmentDocs(
    attachmentId: string,
    currentDocs: IAttachmentEsDoc[],
    index: string,
  ): Promise<void> {
    return deleteDocsByQuery(this.client, index, {
      bool: {
        filter: [{ term: { attachmentId } }],
        must_not: [
          {
            ids: {
              values: currentDocs.map((doc) =>
                buildDocId(attachmentId, doc.pageNumber),
              ),
            },
          },
        ],
      },
    });
  }

  /**
   * Removes all ES documents for the given `attachmentId` from each target index.
   * Uses `deleteByQuery` to cover all page-number variants without knowing them in advance.
   *
   * Failures on individual indexes are logged and swallowed so that a failure on
   * one index does not block removal from the others.
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
        deleteAttachmentDocs(this.client, indexName, [attachmentId]),
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
}
