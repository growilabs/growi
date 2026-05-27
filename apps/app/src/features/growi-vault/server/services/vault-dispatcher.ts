import type { IPage } from '@growi/core';
import type { Namespace } from '@growi/core/dist/interfaces/vault';

import { VaultInstruction } from '~/features/growi-vault/server/models/vault-instruction';
import loggerFactory from '~/utils/logger';

import type { VaultNamespaceMapper } from './vault-namespace-mapper';

const logger = loggerFactory(
  'growi:features:growi-vault:service:vault-dispatcher',
);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Duration (in ms) within which upsert events for the same namespace are
 *  accumulated before being flushed as a bulk-upsert instruction. */
export const COALESCE_WINDOW_MS = 1000;

/** Minimum number of upsert events in a namespace within one coalesce window
 *  that triggers bulk-upsert coalescing instead of individual inserts. */
export const COALESCE_THRESHOLD = 100;

/** Maximum number of entries packed into a single bulk-upsert instruction. */
export const CHUNK_SIZE = 1000;

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

/**
 * Represents a single-page lifecycle event emitted by PageService.
 *
 * `type`:
 *   - 'create' — new page persisted
 *   - 'update' — page body or metadata updated (ACL unchanged)
 *   - 'delete' — page deleted; pagePath contains the pre-deletion path
 *   - 'acl-change' — page ACL changed; previousNamespaces must be provided
 */
export type PageChangedEventType =
  | 'create'
  | 'update'
  | 'delete'
  | 'acl-change';

export interface PageChangedEvent {
  /** Type of change that occurred. */
  readonly type: PageChangedEventType;
  /** The page object reflecting the current (post-change) state. */
  readonly page: IPage & { _id: { toString(): string } };
  /** Revision ID of the current revision (undefined for delete events). */
  readonly revisionId?: string;
  /**
   * Namespaces the page belonged to BEFORE the ACL change.
   * Required when type === 'acl-change'; ignored otherwise.
   */
  readonly previousNamespaces?: ReadonlyArray<Namespace>;
}

/**
 * Represents a bulk operation affecting many descendant pages at once.
 *
 * `type`:
 *   - 'rename-prefix' — parent page path renamed; all descendants shift prefix
 *   - 'grant-change-prefix' — parent page grant changed in bulk
 */
export type BulkPageOperationEventType =
  | 'rename-prefix'
  | 'grant-change-prefix';

export interface BulkPageOperationEvent {
  readonly type: BulkPageOperationEventType;
  /** Namespaces affected by the operation (used for rename-prefix). */
  readonly namespaces: ReadonlyArray<Namespace>;
  /** For rename-prefix: the old path prefix. */
  readonly oldPrefix?: string;
  /** For rename-prefix: the new path prefix. */
  readonly newPrefix?: string;
  /**
   * For grant-change-prefix: pairs of (fromNamespace, toNamespace).
   * Each pair generates one grant-change-prefix instruction.
   */
  readonly namespacePairs?: ReadonlyArray<{
    fromNamespace: Namespace;
    toNamespace: Namespace;
  }>;
}

// ---------------------------------------------------------------------------
// VaultDispatcher interface
// ---------------------------------------------------------------------------

/**
 * Represents the rename of a single page (the page itself, not its descendants).
 *
 * A GROWI page is stored in the namespace tree as a blob (`<name>.md`), so a
 * rename of the page's own path cannot be expressed as a directory-subtree
 * `rename-prefix` (that op only relocates `type === 'tree'` entries). We model
 * a single-page rename as remove(oldPath) + upsert(newPath) instead, which
 * correctly moves the blob. Descendant relocation is still handled by the
 * `rename-prefix` instruction emitted from the 'updateMany' event.
 */
export interface PageRenamedEvent {
  /** The page object reflecting the current (post-rename) state. */
  readonly page: IPage & { _id: { toString(): string } };
  /** The page path before the rename. */
  readonly oldPath: string;
  /** The page path after the rename. */
  readonly newPath: string;
  /** Revision ID of the current revision (upsert is skipped when absent). */
  readonly revisionId?: string;
}

export interface VaultDispatcher {
  /**
   * Handle a single-page lifecycle event.
   * Writes upsert / remove instructions to vault_instructions.
   * For high-frequency upserts on the same namespace within a coalesce window,
   * individual writes are batched into a single bulk-upsert instruction.
   */
  onPageChanged(event: PageChangedEvent): Promise<void>;

  /**
   * Handle the rename of a single page's own path.
   * Emits a remove (old path) + upsert (new path) per namespace so the page's
   * blob is relocated within the namespace tree. Grant is unchanged by a
   * rename, so old and new paths live in the same namespace set.
   */
  onPageRenamed(event: PageRenamedEvent): Promise<void>;

  /**
   * Handle a bulk operation affecting many descendant pages.
   * Writes rename-prefix or grant-change-prefix instructions to vault_instructions,
   * one per affected namespace (regardless of descendant page count).
   */
  onBulkOperation(event: BulkPageOperationEvent): Promise<void>;
}

// ---------------------------------------------------------------------------
// Coalesce buffer types (module-internal)
// ---------------------------------------------------------------------------

interface BulkUpsertEntry {
  pageId: string;
  pagePath: string;
  revisionId: string;
}

interface CoalesceBuffer {
  entries: BulkUpsertEntry[];
  timer: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

/**
 * Attempt a vault_instructions write and retry once on transient failure.
 * Decoupled from page-edit response: failures are logged as WARN and retried
 * asynchronously rather than surfaced to the caller.
 */
const writeWithRetry = async (
  writeFn: () => Promise<void>,
  description: string,
): Promise<void> => {
  try {
    await writeFn();
  } catch (firstError) {
    logger.warn(
      { error: firstError },
      `vault-dispatcher: write failed (${description}), retrying…`,
    );
    try {
      await writeFn();
    } catch (secondError) {
      logger.warn(
        { error: secondError },
        `vault-dispatcher: write failed after retry (${description})`,
      );
    }
  }
};

/**
 * Flush all accumulated entries for a namespace as one or more bulk-upsert
 * instructions (chunked at CHUNK_SIZE).
 * Chunks are written in parallel since ordering within a flush is not required.
 */
const flushCoalesceBuffer = async (
  namespace: Namespace,
  entries: BulkUpsertEntry[],
): Promise<void> => {
  // Partition entries into chunks of at most CHUNK_SIZE.
  const chunks: BulkUpsertEntry[][] = [];
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    chunks.push(entries.slice(i, i + CHUNK_SIZE));
  }

  // Write all chunks concurrently — order within a flush does not matter.
  await Promise.all(
    chunks.map((chunk) =>
      writeWithRetry(
        () =>
          VaultInstruction.create({
            op: 'bulk-upsert',
            payload: {
              namespace,
              entries: chunk.map((e) => ({
                pageId: e.pageId,
                pagePath: e.pagePath,
                revisionId: e.revisionId,
              })),
            },
            issuedAt: new Date(),
          }).then(() => undefined),
        `bulk-upsert namespace=${namespace} entries=${chunk.length}`,
      ),
    ),
  );
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a VaultDispatcher bound to the given VaultNamespaceMapper.
 *
 * The mapper is injected so that unit tests can supply a lightweight stub
 * without requiring MongoDB or the real ACL resolution stack.
 */
export const createVaultDispatcher = (
  namespaceMapper: VaultNamespaceMapper,
): VaultDispatcher => {
  /**
   * Per-namespace coalesce state.
   * Key: namespace string.
   * Value: pending entries + the timeout that will flush them.
   *
   * Invariant: if an entry exists in this map, its timer is pending.
   * When the timer fires OR when the entry count crosses CHUNK_SIZE
   * (triggering an immediate flush), the map entry is deleted.
   */
  const coalesceMap = new Map<Namespace, CoalesceBuffer>();

  /**
   * Enqueue one upsert entry into the coalesce buffer for the given namespace.
   * If the buffer reaches CHUNK_SIZE, the chunk is flushed immediately without
   * waiting for the timer (avoids unbounded memory accumulation).
   *
   * All flushes are fire-and-forget from the caller's perspective — errors are
   * caught internally and logged as WARN.
   */
  const enqueueUpsert = (
    namespace: Namespace,
    entry: BulkUpsertEntry,
  ): void => {
    let buf = coalesceMap.get(namespace);

    if (buf == null) {
      // Start a new coalesce window for this namespace.
      const timer = setTimeout(() => {
        const currentBuf = coalesceMap.get(namespace);
        coalesceMap.delete(namespace);
        if (currentBuf == null || currentBuf.entries.length === 0) {
          return;
        }

        if (currentBuf.entries.length >= COALESCE_THRESHOLD) {
          // Enough events accumulated — flush as bulk-upsert.
          flushCoalesceBuffer(namespace, currentBuf.entries).catch((err) => {
            logger.warn(
              { namespace, error: err },
              'vault-dispatcher: failed to flush coalesce buffer',
            );
          });
        } else {
          // Below threshold — write individual upsert instructions concurrently.
          Promise.all(
            currentBuf.entries.map((e) =>
              writeWithRetry(
                () =>
                  VaultInstruction.create({
                    op: 'upsert',
                    payload: {
                      namespace,
                      pageId: e.pageId,
                      pagePath: e.pagePath,
                      revisionId: e.revisionId,
                    },
                    issuedAt: new Date(),
                  }).then(() => undefined),
                `upsert namespace=${namespace} pageId=${e.pageId}`,
              ),
            ),
          ).catch((err) => {
            logger.warn(
              { namespace, error: err },
              'vault-dispatcher: failed to write upserts on timer flush',
            );
          });
        }
      }, COALESCE_WINDOW_MS);

      buf = { entries: [], timer };
      coalesceMap.set(namespace, buf);
    }

    buf.entries.push(entry);

    // If entries hit CHUNK_SIZE, flush this chunk immediately.
    if (buf.entries.length >= CHUNK_SIZE) {
      clearTimeout(buf.timer);
      coalesceMap.delete(namespace);
      const entriesToFlush = buf.entries;
      flushCoalesceBuffer(namespace, entriesToFlush).catch((err) => {
        logger.warn(
          { namespace, error: err },
          'vault-dispatcher: failed to flush full chunk',
        );
      });
    }
  };

  return {
    async onPageChanged(event: PageChangedEvent): Promise<void> {
      const { type, page } = event;
      const pageId = page._id.toString();
      const pagePath = page.path;
      const revisionId = event.revisionId ?? '';

      if (type === 'create' || type === 'update') {
        // Skip pages that have no revision yet (e.g. auto-generated intermediate
        // path pages). vault-manager would fail with a MongoDB ObjectId cast error
        // if we forwarded an empty revisionId.
        if (!revisionId) {
          logger.debug(
            { pageId, pagePath },
            'vault-dispatcher: skipping upsert for page without revision',
          );
          return;
        }
        // Compute current namespaces and enqueue an upsert per namespace.
        const { current } = namespaceMapper.computePageNamespaces(page);
        for (const ns of current) {
          enqueueUpsert(ns, { pageId, pagePath, revisionId });
        }
        return;
      }

      if (type === 'delete') {
        // Compute current (pre-deletion) namespaces and write a remove per namespace.
        // Concurrent writes are safe here — remove instructions are independent.
        const { current } = namespaceMapper.computePageNamespaces(page);
        await Promise.all(
          current.map((ns) =>
            writeWithRetry(
              () =>
                VaultInstruction.create({
                  op: 'remove',
                  payload: { namespace: ns, pageId, pagePath },
                  issuedAt: new Date(),
                }).then(() => undefined),
              `remove namespace=${ns} pageId=${pageId}`,
            ),
          ),
        );
        return;
      }

      if (type === 'acl-change') {
        const previousNamespaces = event.previousNamespaces ?? [];
        const { current } = namespaceMapper.computePageNamespaces(page);

        // Emit remove instructions for all previous namespaces concurrently.
        // Upsert instructions for current namespaces are only emitted when
        // revisionId is present — pages without a revision (e.g. auto-generated
        // intermediate paths) would cause a MongoDB ObjectId cast error in
        // vault-manager if forwarded.
        if (!revisionId) {
          logger.debug(
            { pageId, pagePath },
            'vault-dispatcher: skipping acl-change upsert for page without revision',
          );
          await Promise.all(
            previousNamespaces.map((ns) =>
              writeWithRetry(
                () =>
                  VaultInstruction.create({
                    op: 'remove',
                    payload: { namespace: ns, pageId, pagePath },
                    issuedAt: new Date(),
                  }).then(() => undefined),
                `acl-remove namespace=${ns} pageId=${pageId}`,
              ),
            ),
          );
          return;
        }

        // Emit remove instructions for all previous namespaces and upsert
        // instructions for all current namespaces, both concurrently.
        await Promise.all([
          ...previousNamespaces.map((ns) =>
            writeWithRetry(
              () =>
                VaultInstruction.create({
                  op: 'remove',
                  payload: { namespace: ns, pageId, pagePath },
                  issuedAt: new Date(),
                }).then(() => undefined),
              `acl-remove namespace=${ns} pageId=${pageId}`,
            ),
          ),
          ...current.map((ns) =>
            writeWithRetry(
              () =>
                VaultInstruction.create({
                  op: 'upsert',
                  payload: { namespace: ns, pageId, pagePath, revisionId },
                  issuedAt: new Date(),
                }).then(() => undefined),
              `acl-upsert namespace=${ns} pageId=${pageId}`,
            ),
          ),
        ]);
        return;
      }

      logger.warn(
        { type },
        'vault-dispatcher: received unknown PageChangedEvent type',
      );
    },

    async onPageRenamed(event: PageRenamedEvent): Promise<void> {
      const { page, oldPath, newPath } = event;
      const pageId = page._id.toString();
      const revisionId = event.revisionId ?? '';

      // Grant is unchanged by a rename, so the page lives in the same
      // namespaces before and after. Remove the page's blob at the old path
      // and re-add it at the new path in every namespace it belongs to.
      const { current } = namespaceMapper.computePageNamespaces(page);

      const removes = current.map((ns) =>
        writeWithRetry(
          () =>
            VaultInstruction.create({
              op: 'remove',
              payload: { namespace: ns, pageId, pagePath: oldPath },
              issuedAt: new Date(),
            }).then(() => undefined),
          `rename-remove namespace=${ns} pageId=${pageId}`,
        ),
      );

      // Skip the upsert when no revision is available (e.g. auto-generated
      // intermediate pages); vault-manager would fail on an empty revisionId.
      // The old-path removal still runs so no orphan blob is left behind.
      const upserts = revisionId
        ? current.map((ns) =>
            writeWithRetry(
              () =>
                VaultInstruction.create({
                  op: 'upsert',
                  payload: {
                    namespace: ns,
                    pageId,
                    pagePath: newPath,
                    revisionId,
                  },
                  issuedAt: new Date(),
                }).then(() => undefined),
              `rename-upsert namespace=${ns} pageId=${pageId}`,
            ),
          )
        : [];

      await Promise.all([...removes, ...upserts]);
    },

    async onBulkOperation(event: BulkPageOperationEvent): Promise<void> {
      if (event.type === 'rename-prefix') {
        // One rename-prefix instruction per affected namespace, written concurrently.
        await Promise.all(
          event.namespaces.map((ns) =>
            writeWithRetry(
              () =>
                VaultInstruction.create({
                  op: 'rename-prefix',
                  payload: {
                    namespace: ns,
                    oldPrefix: event.oldPrefix,
                    newPrefix: event.newPrefix,
                  },
                  issuedAt: new Date(),
                }).then(() => undefined),
              `rename-prefix namespace=${ns}`,
            ),
          ),
        );
        return;
      }

      if (event.type === 'grant-change-prefix') {
        // One grant-change-prefix instruction per (fromNamespace, toNamespace) pair.
        const pairs = event.namespacePairs ?? [];
        await Promise.all(
          pairs.map(({ fromNamespace, toNamespace }) =>
            writeWithRetry(
              () =>
                VaultInstruction.create({
                  op: 'grant-change-prefix',
                  payload: {
                    namespace: toNamespace,
                    fromNamespace,
                  },
                  issuedAt: new Date(),
                }).then(() => undefined),
              `grant-change-prefix from=${fromNamespace} to=${toNamespace}`,
            ),
          ),
        );
        return;
      }

      logger.warn(
        { type: event.type },
        'vault-dispatcher: received unknown BulkPageOperationEvent type',
      );
    },
  };
};

// ---------------------------------------------------------------------------
// Default singleton
// ---------------------------------------------------------------------------

// The default singleton is created lazily (imported where needed) so that
// the production consumer can inject the real vaultNamespaceMapper while
// tests inject a stub.
// Export the factory and let the feature-registration module wire the singleton.
