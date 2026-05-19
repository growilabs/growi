import type { IPage } from '@growi/core';
import type {
  Namespace,
  VaultBulkUpsertEntry,
} from '@growi/core/dist/interfaces/vault';
import mongoose from 'mongoose';

import { VaultInstruction } from '~/features/growi-vault/server/models/vault-instruction';
import { VaultSyncState } from '~/features/growi-vault/server/models/vault-sync-state';
import type { PageDocument, PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import type { VaultNamespaceMapper } from './vault-namespace-mapper';

const logger = loggerFactory(
  'growi:features:growi-vault:service:vault-bootstrapper',
);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of entries packed into a single bulk-upsert instruction per namespace. */
export const CHUNK_SIZE = 1000;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface BootstrapStatus {
  state: 'pending' | 'running' | 'done' | 'failed';
  processed: number;
  totalEstimated: number | null;
  cursor: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  lastError: string | null;
}

export interface VaultBootstrapper {
  start(opts?: { triggerSource: 'admin-ui' | 'env-var' }): Promise<void>;
  getStatus(): Promise<BootstrapStatus>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Flush all accumulated namespace buffers to vault_instructions as bulk-upsert
 * instructions. Each namespace with at least one entry produces one instruction.
 */
const flushBuffers = async (
  buffers: Map<Namespace, VaultBulkUpsertEntry[]>,
): Promise<void> => {
  const flushPromises: Promise<unknown>[] = [];

  for (const [namespace, entries] of buffers.entries()) {
    if (entries.length === 0) {
      continue;
    }
    flushPromises.push(
      VaultInstruction.create({
        op: 'bulk-upsert',
        payload: { namespace, entries },
        issuedAt: new Date(),
      }),
    );
    buffers.set(namespace, []);
  }

  await Promise.all(flushPromises);
};

/**
 * Factory function that creates the VaultBootstrapper implementation.
 *
 * Accepts a VaultNamespaceMapper so that unit tests can inject stubs without
 * requiring a real MongoDB connection.
 */
export const createVaultBootstrapper = (
  namespaceMapper: VaultNamespaceMapper,
): VaultBootstrapper => {
  return {
    /**
     * Start (or resume) the bootstrap process.
     *
     * Processing flow:
     * 1. Guard against double-start: return immediately if already running.
     * 2. Transition bootstrapState to 'running' and record bootstrapStartedAt.
     * 3. Estimate the total page count and store it in bootstrapTotalEstimated.
     * 4. Issue a 'reset-all' instruction to signal vault-manager to wipe state.
     * 5. Stream published, non-trash pages through a Mongoose cursor. For each
     *    page compute its namespace(s), accumulate entries in per-namespace
     *    buffers, and flush each buffer when CHUNK_SIZE is reached.
     * 6. Flush all remaining buffers.
     * 7. Transition bootstrapState to 'done' and record bootstrapCompletedAt.
     *
     * On any thrown error: transition bootstrapState to 'failed' and record
     * the error message in bootstrapLastError (surfaced as `lastError` in the
     * BootstrapStatus contract).
     *
     * Resume: if bootstrapCursor is non-null in vault_sync_state, the page
     * query is filtered to { _id: { $gt: bootstrapCursor } } so that a
     * previously interrupted run continues from where it left off.
     */
    async start(opts?: {
      triggerSource: 'admin-ui' | 'env-var';
    }): Promise<void> {
      // -----------------------------------------------------------------------
      // Step 1: Double-start guard
      // -----------------------------------------------------------------------
      const currentState = await VaultSyncState.findOneAndUpdate(
        { _id: 'singleton' },
        { $setOnInsert: { bootstrapState: 'pending', bootstrapProcessed: 0 } },
        { upsert: true, new: true },
      );

      if (currentState?.bootstrapState === 'running') {
        logger.info(
          'Bootstrap already running — ignoring duplicate start request',
        );
        return;
      }

      // -----------------------------------------------------------------------
      // Step 2: Transition to 'running'
      // -----------------------------------------------------------------------
      const syncState = await VaultSyncState.findOneAndUpdate(
        { _id: 'singleton' },
        {
          $set: {
            bootstrapState: 'running',
            bootstrapStartedAt: new Date(),
            bootstrapProcessed: 0,
            bootstrapCompletedAt: null,
            bootstrapLastError: null,
          },
        },
        { upsert: true, new: true },
      );

      const resumeCursor = syncState?.bootstrapCursor ?? null;
      if (resumeCursor != null) {
        logger.info(
          { cursor: resumeCursor.toString() },
          'Resuming bootstrap from cursor',
        );
      }

      logger.info(
        { triggerSource: opts?.triggerSource ?? 'unknown' },
        'Bootstrap started',
      );

      try {
        // -----------------------------------------------------------------------
        // Step 3: Estimate total pages
        // -----------------------------------------------------------------------
        const Page = mongoose.model<PageDocument, PageModel>('Page');
        const totalEstimated = await Page.estimatedDocumentCount();

        await VaultSyncState.updateOne(
          { _id: 'singleton' },
          { $set: { bootstrapTotalEstimated: totalEstimated } },
        );

        // -----------------------------------------------------------------------
        // Step 4: Issue reset-all instruction
        // -----------------------------------------------------------------------
        await VaultInstruction.create({
          op: 'reset-all',
          payload: {},
          issuedAt: new Date(),
        });

        // -----------------------------------------------------------------------
        // Step 5: Stream pages and accumulate per-namespace buffers
        // -----------------------------------------------------------------------
        const query: mongoose.FilterQuery<PageDocument> = {
          status: 'published',
          path: { $not: /^\/trash/ },
        };

        // Resume support: skip pages already processed in a previous run
        if (resumeCursor != null) {
          query._id = { $gt: resumeCursor };
        }

        const namespaceBuffers = new Map<Namespace, VaultBulkUpsertEntry[]>();
        let processed = 0;

        const cursor = Page.find(query).cursor();

        for await (const page of cursor as AsyncIterable<PageDocument>) {
          processed += 1;

          // Skip auto-generated intermediate path pages that have no revision.
          // Passing revisionId: '' to vault-manager causes a MongoDB ObjectId
          // cast failure, breaking the vault.
          if (page.revision == null) {
            logger.debug(
              { pageId: page._id!.toString(), pagePath: page.path },
              'vault-bootstrapper: skipping page without revision',
            );
            await VaultSyncState.updateOne(
              { _id: 'singleton' },
              {
                $set: {
                  bootstrapCursor: page._id,
                  bootstrapProcessed: processed,
                },
              },
            );
            continue;
          }

          const { current } = namespaceMapper.computePageNamespaces(
            page as unknown as IPage,
          );

          for (const ns of current) {
            if (!namespaceBuffers.has(ns)) {
              namespaceBuffers.set(ns, []);
            }
            const buf = namespaceBuffers.get(ns)!;
            buf.push({
              pageId: page._id!.toString(),
              pagePath: page.path ?? '',
              revisionId: page.revision.toString(),
            });

            // Flush this namespace's buffer when CHUNK_SIZE is reached
            if (buf.length >= CHUNK_SIZE) {
              await VaultInstruction.create({
                op: 'bulk-upsert',
                payload: { namespace: ns, entries: buf },
                issuedAt: new Date(),
              });
              namespaceBuffers.set(ns, []);
            }
          }

          // Update cursor and processed count after each page
          await VaultSyncState.updateOne(
            { _id: 'singleton' },
            {
              $set: {
                bootstrapCursor: page._id,
                bootstrapProcessed: processed,
              },
            },
          );
        }

        // -----------------------------------------------------------------------
        // Step 6: Flush remaining buffers
        // -----------------------------------------------------------------------
        await flushBuffers(namespaceBuffers);

        // -----------------------------------------------------------------------
        // Step 7: Mark as done
        // -----------------------------------------------------------------------
        await VaultSyncState.updateOne(
          { _id: 'singleton' },
          {
            $set: {
              bootstrapState: 'done',
              bootstrapCompletedAt: new Date(),
            },
          },
        );

        logger.info({ processed }, 'Bootstrap completed successfully');
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error({ error }, 'Bootstrap failed');

        await VaultSyncState.updateOne(
          { _id: 'singleton' },
          {
            $set: {
              bootstrapState: 'failed',
              bootstrapLastError: errorMessage,
            },
          },
        );
      }
    },

    /**
     * Return the current bootstrap status from vault_sync_state.
     */
    async getStatus(): Promise<BootstrapStatus> {
      const doc = await VaultSyncState.findOne({ _id: 'singleton' }).lean();

      if (doc == null) {
        return {
          state: 'pending',
          processed: 0,
          totalEstimated: null,
          cursor: null,
          startedAt: null,
          completedAt: null,
          lastError: null,
        };
      }

      return {
        state: doc.bootstrapState,
        processed: doc.bootstrapProcessed,
        totalEstimated: doc.bootstrapTotalEstimated ?? null,
        cursor: doc.bootstrapCursor?.toString() ?? null,
        startedAt: doc.bootstrapStartedAt ?? null,
        completedAt: doc.bootstrapCompletedAt ?? null,
        lastError: doc.bootstrapLastError ?? null,
      };
    },
  };
};

/**
 * Default singleton instance. Production code should call
 * createVaultBootstrapper(vaultNamespaceMapper) during app startup and store
 * the result in the DI container; this export is provided as a convenience.
 */
export { createVaultBootstrapper as vaultBootstrapperFactory };
