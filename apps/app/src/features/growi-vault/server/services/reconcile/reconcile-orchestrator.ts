/**
 * reconcile-orchestrator.ts
 *
 * Async worker that processes an accepted reconcile request:
 *   - Streams pages via cursor (with hard-cap limit)
 *   - Computes namespaces per page via VaultNamespaceMapper
 *   - Accumulates entries in per-namespace buffers
 *   - Flushes buffers as bulk-upsert instructions to vault_instructions
 *   - Records lifecycle status in vault_reconcile_log
 *   - Emits audit events via createActivity
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.4, 5.5, 6.10, 6.11
 * Design: Components and Interfaces > ReconcileOrchestrator
 */

import loggerFactory from '~/utils/logger';

import type { VaultInstructionModel } from '../../models/vault-instruction';
import type { VaultReconcileLogModel } from '../../models/vault-reconcile-log';
import type { ReconcileTargetType } from './reconcile-history-store';

const logger = loggerFactory(
  'growi:features:growi-vault:service:reconcile:orchestrator',
);

// ---------------------------------------------------------------------------
// Audit action constants
// ---------------------------------------------------------------------------

const ACTION_RECONCILE_STARTED = 'vault.reconcile.started';
const ACTION_RECONCILE_COMPLETED = 'vault.reconcile.completed';
const ACTION_RECONCILE_FAILED = 'vault.reconcile.failed';
const ACTION_RECONCILE_PARTIAL_ACL_FILTERED =
  'vault.reconcile.partial-acl-filtered';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface BulkUpsertEntry {
  pageId: string;
  pagePath: string;
  revisionId: string;
}

interface ActivityData {
  action: string;
  user: null;
  ip: string;
  data?: Record<string, unknown>;
}

type CreateActivity = (activityData: ActivityData) => Promise<unknown>;

// Minimal page shape required by this module (lean() result)
interface StreamedPage {
  _id: { toString(): string };
  path?: string | null;
  revision?: { toString(): string } | null;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** MongoDB FilterQuery subset accepted as eligibleQuery. */
export type PageQueryFilter = Record<string, unknown>;

export interface ReconcileOrchestrator {
  run(opts: {
    reconcileId: string;
    eligibleQuery: PageQueryFilter;
    /** Number of pages expected to be processed. Used as the hard-cap base. */
    plannedPageCount: number;
    triggeredBy: { userId: string; isAdmin: boolean };
    targetType: ReconcileTargetType;
    targetPath: string;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory dependencies
// ---------------------------------------------------------------------------

export interface ReconcileOrchestratorDeps {
  /** Page Mongoose model — used for cursor streaming. */
  pageModel: {
    find(query: PageQueryFilter): {
      limit(n: number): {
        lean(): {
          cursor(): AsyncIterable<StreamedPage> & { close(): Promise<void> };
        };
      };
    };
  };
  /** VaultInstruction model — write only, bulk-upsert op. */
  vaultInstruction: Pick<VaultInstructionModel, 'create'>;
  /** Namespace mapper — computes ACL-based namespaces for a page. */
  vaultNamespaceMapper: {
    computePageNamespaces(page: StreamedPage): {
      current: ReadonlyArray<string>;
    };
  };
  /** VaultReconcileLog model — lifecycle record persistence. */
  vaultReconcileLog: Pick<VaultReconcileLogModel, 'updateOne'>;
  /** Optional audit log factory. */
  createActivity?: CreateActivity;
  /** Max entries per bulk-upsert instruction per namespace. */
  chunkSize: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createReconcileOrchestrator(
  deps: ReconcileOrchestratorDeps,
): ReconcileOrchestrator {
  const {
    pageModel,
    vaultInstruction,
    vaultNamespaceMapper,
    vaultReconcileLog,
    createActivity,
    chunkSize,
  } = deps;

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Flush a single namespace buffer as a bulk-upsert instruction. */
  async function flushNamespaceBuffer(
    namespace: string,
    entries: BulkUpsertEntry[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await vaultInstruction.create({
      op: 'bulk-upsert',
      payload: { namespace, entries },
      issuedAt: new Date(),
    });
  }

  /** Flush all non-empty namespace buffers. */
  async function flushAllBuffers(
    buffers: Map<string, BulkUpsertEntry[]>,
  ): Promise<void> {
    for (const [namespace, entries] of buffers.entries()) {
      if (entries.length > 0) {
        // biome-ignore lint/performance/noAwaitInLoops: sequential flush preserves instruction order
        await flushNamespaceBuffer(namespace, entries);
        buffers.set(namespace, []);
      }
    }
  }

  /** Emit an audit activity; no-op when createActivity is not provided. */
  async function emitAudit(
    action: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    if (createActivity == null) return;
    await createActivity({ action, user: null, ip: '0.0.0.0', data });
  }

  // -------------------------------------------------------------------------
  // run()
  // -------------------------------------------------------------------------

  async function run(opts: {
    reconcileId: string;
    eligibleQuery: PageQueryFilter;
    plannedPageCount: number;
    triggeredBy: { userId: string; isAdmin: boolean };
    targetType: ReconcileTargetType;
    targetPath: string;
  }): Promise<void> {
    const {
      reconcileId,
      eligibleQuery,
      plannedPageCount,
      triggeredBy,
      targetType,
      targetPath,
    } = opts;

    const startedAt = new Date();

    // Step 1: Mark as running
    await vaultReconcileLog.updateOne(
      { reconcileId },
      { $set: { status: 'running', startedAt } },
    );

    // Step 2: Emit started audit
    await emitAudit(ACTION_RECONCILE_STARTED, {
      reconcileId,
      userId: triggeredBy.userId,
      isAdmin: triggeredBy.isAdmin,
      targetType,
      targetPath,
      plannedPageCount,
    });

    // Step 3: Build cursor with hard-cap
    const cursor = pageModel
      .find(eligibleQuery)
      .limit(plannedPageCount + 1)
      .lean()
      .cursor();

    let processedCount = 0;
    const namespaceBuffers = new Map<string, BulkUpsertEntry[]>();

    try {
      // Step 4–6: Stream pages
      for await (const page of cursor) {
        processedCount += 1;

        // Step 6: Hard-cap check — (plannedPageCount + 1)th page signals limit-exceeded
        if (processedCount > plannedPageCount) {
          await cursor.close();
          const completedAt = new Date();
          await vaultReconcileLog.updateOne(
            { reconcileId },
            {
              $set: {
                status: 'failed',
                lastError: 'limit-exceeded',
                completedAt,
              },
            },
          );
          await emitAudit(ACTION_RECONCILE_FAILED, {
            reconcileId,
            processedCount: plannedPageCount, // report capped count
            error: 'limit-exceeded',
          });
          return;
        }

        // Compute namespaces for this page
        const { current: namespaces } =
          vaultNamespaceMapper.computePageNamespaces(page as never);

        const entry: BulkUpsertEntry = {
          pageId: page._id.toString(),
          pagePath: page.path ?? '',
          revisionId: page.revision?.toString() ?? '',
        };

        // Accumulate in per-namespace buffers
        for (const ns of namespaces) {
          let buf = namespaceBuffers.get(ns);
          if (buf == null) {
            buf = [];
            namespaceBuffers.set(ns, buf);
          }
          buf.push(entry);

          // Step 5: Flush when buffer reaches chunkSize
          if (buf.length >= chunkSize) {
            // biome-ignore lint/performance/noAwaitInLoops: sequential flush preserves instruction order
            await flushNamespaceBuffer(ns, buf);
            namespaceBuffers.set(ns, []);
          }
        }
      }

      // Step 7: Flush remaining buffers after stream ends
      await flushAllBuffers(namespaceBuffers);

      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();

      // Step 8: Partial ACL-filtered audit (non-admin only)
      if (!triggeredBy.isAdmin && processedCount < plannedPageCount) {
        await emitAudit(ACTION_RECONCILE_PARTIAL_ACL_FILTERED, {
          reconcileId,
          plannedPageCount,
          processedCount,
        });
      }

      // Step 9: Mark as completed
      await vaultReconcileLog.updateOne(
        { reconcileId },
        { $set: { status: 'completed', completedAt, processedCount } },
      );
      await emitAudit(ACTION_RECONCILE_COMPLETED, {
        reconcileId,
        processedCount,
        durationMs,
      });
    } catch (error) {
      // Step 10: Handle unexpected exceptions
      const completedAt = new Date();
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.warn(
        { reconcileId, error: errorMessage },
        'ReconcileOrchestrator: run failed',
      );

      await vaultReconcileLog.updateOne(
        { reconcileId },
        { $set: { status: 'failed', lastError: errorMessage, completedAt } },
      );
      await emitAudit(ACTION_RECONCILE_FAILED, {
        reconcileId,
        processedCount,
        error: errorMessage,
      });
    }
  }

  return { run };
}
