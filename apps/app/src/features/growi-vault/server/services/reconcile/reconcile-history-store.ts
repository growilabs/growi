/**
 * reconcile-history-store.ts
 *
 * CRUD wrapper for the vault_reconcile_log collection.
 * Provides create / updateStatus / listRecent / normalizeStaleLifecycle
 * operations for the reconcile lifecycle history.
 *
 * Requirements: 5.1, 5.5
 * Design: Components and Interfaces > HistoryStore
 */

import type {
  ReconcileTargetType,
  VaultReconcileLogModel,
} from '~/features/growi-vault/server/models/vault-reconcile-log';

// ---------------------------------------------------------------------------
// Re-exports needed by other modules in the reconcile module group
// ---------------------------------------------------------------------------

export type { ReconcileTargetType };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Reject reasons for a reconcile request.
 * Mirrors the design-spec ReconcileRejectReason enum.
 */
export type ReconcileRejectReason =
  | 'invalid-target'
  | 'bootstrap-not-done'
  | 'page-count-exceeds-user-limit'
  | 'page-count-exceeds-admin-limit'
  | 'user-concurrency-limit'
  | 'system-concurrency-limit';

/**
 * Plain view of a single reconcile lifecycle record.
 *
 * `startedAt`, `completedAt`, and `lastError` are optional because they are
 * absent from the initial `create` payload (written later via `updateStatus`).
 */
export interface ReconcileLogEntry {
  readonly reconcileId: string;
  readonly triggeredBy: { userId: string; isAdmin: boolean };
  readonly targetType: ReconcileTargetType;
  readonly targetPath: string;
  /** Raw descendantCount from the target page at accept time. Null for rejects
   *  where the target page could not be resolved. */
  readonly descendantCount: number | null;
  readonly processedCount: number;
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'rejected';
  readonly rejectReason?: ReconcileRejectReason;
  readonly triggeredAt: Date;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly lastError?: string;
}

/**
 * Public interface for the vault_reconcile_log CRUD wrapper.
 */
export interface HistoryStore {
  /**
   * Inserts a new lifecycle record into vault_reconcile_log.
   * `startedAt`, `completedAt`, and `lastError` are not part of the initial
   * insert — they are set later via `updateStatus`.
   */
  create(
    entry: Omit<ReconcileLogEntry, 'startedAt' | 'completedAt' | 'lastError'>,
  ): Promise<void>;

  /**
   * Applies a partial status patch to an existing record identified by
   * `reconcileId`.
   */
  updateStatus(
    reconcileId: string,
    patch: Partial<
      Pick<
        ReconcileLogEntry,
        | 'status'
        | 'startedAt'
        | 'completedAt'
        | 'processedCount'
        | 'lastError'
        | 'rejectReason'
      >
    >,
  ): Promise<void>;

  /**
   * Returns recent reconcile log entries sorted by triggeredAt descending.
   * `offset` defaults to 0 when omitted.
   */
  listRecent(opts: {
    limit: number;
    offset?: number;
  }): Promise<readonly ReconcileLogEntry[]>;

  /**
   * Startup migration step.
   *
   * Bulk-updates all records whose `status` is `'running'` or `'pending'` to:
   *   { status: 'failed', lastError: 'process-restarted', completedAt: <now> }
   *
   * Including `'pending'` absorbs records where the accept gate inserted the
   * log row but the process crashed before the orchestrator started.
   *
   * Returns the number of records updated.
   */
  normalizeStaleLifecycle(): Promise<number>;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface HistoryStoreDeps {
  /** The Mongoose model for the vault_reconcile_log collection. */
  vaultReconcileLog: Pick<
    VaultReconcileLogModel,
    'create' | 'updateOne' | 'updateMany' | 'find'
  >;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Factory that creates a HistoryStore bound to the given VaultReconcileLog model.
 */
export function createHistoryStore(deps: HistoryStoreDeps): HistoryStore {
  const { vaultReconcileLog } = deps;

  return {
    async create(
      entry: Omit<ReconcileLogEntry, 'startedAt' | 'completedAt' | 'lastError'>,
    ): Promise<void> {
      await vaultReconcileLog.create({
        reconcileId: entry.reconcileId,
        triggeredBy: entry.triggeredBy,
        targetType: entry.targetType,
        targetPath: entry.targetPath,
        descendantCount: entry.descendantCount,
        processedCount: entry.processedCount,
        status: entry.status,
        rejectReason: entry.rejectReason ?? null,
        triggeredAt: entry.triggeredAt,
      });
    },

    async updateStatus(
      reconcileId: string,
      patch: Partial<
        Pick<
          ReconcileLogEntry,
          | 'status'
          | 'startedAt'
          | 'completedAt'
          | 'processedCount'
          | 'lastError'
          | 'rejectReason'
        >
      >,
    ): Promise<void> {
      await vaultReconcileLog.updateOne({ reconcileId }, { $set: patch });
    },

    async listRecent(opts: {
      limit: number;
      offset?: number;
    }): Promise<readonly ReconcileLogEntry[]> {
      const offset = opts.offset ?? 0;
      const docs = await vaultReconcileLog
        .find({})
        .sort({ triggeredAt: -1 })
        .skip(offset)
        .limit(opts.limit)
        .lean();
      return docs as unknown as readonly ReconcileLogEntry[];
    },

    async normalizeStaleLifecycle(): Promise<number> {
      const result = await vaultReconcileLog.updateMany(
        { status: { $in: ['running', 'pending'] } },
        {
          $set: {
            status: 'failed',
            lastError: 'process-restarted',
            completedAt: new Date(),
          },
        },
      );
      return result.modifiedCount;
    },
  };
}
