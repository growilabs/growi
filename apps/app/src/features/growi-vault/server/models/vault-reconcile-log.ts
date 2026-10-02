import type mongoose from 'mongoose';
import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

// ---------------------------------------------------------------------------
// TTL constant
// ---------------------------------------------------------------------------

/**
 * Retention period for vault_reconcile_log documents in seconds.
 * Default: 30 days.
 *
 * When config infrastructure for reconcile is wired in (task 3.3), this
 * constant can be replaced by a dynamic lookup. Until then, it is hardcoded
 * here so that it is easy to locate and update.
 */
export const RECONCILE_LOG_TTL_SECONDS = 30 * 86400;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The two target scope kinds that reconcile accepts. */
export type ReconcileTargetType = 'page' | 'sub-tree';

/**
 * Status of a single reconcile lifecycle record.
 *
 * Transitions (single direction):
 *   pending → running → completed | failed
 *   rejected is written directly (never passes through running)
 */
export type ReconcileStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected';

/**
 * Plain interface for a vault_reconcile_log document.
 *
 * Note: `plannedPageCount` is intentionally absent from the schema.
 * It is a derived value: `(targetType === 'page') ? 1 : 1 + descendantCount`.
 * Callers should compute it on demand rather than persisting it.
 */
export interface IVaultReconcileLog {
  /** UUID v4 issued at submit time. External referenceable identifier. */
  reconcileId: string;

  /** Time the reconcile request was received. Used as the TTL retention anchor. */
  triggeredAt: Date;

  /** Who triggered this reconcile. */
  triggeredBy: {
    /** ObjectId of the user who triggered the reconcile. */
    userId: mongoose.Types.ObjectId;
    /** Snapshot of the user's admin status at trigger time. */
    isAdmin: boolean;
  };

  /** Whether the target is a single page or an entire sub-tree. */
  targetType: ReconcileTargetType;

  /** The page path (single page) or path prefix (sub-tree) being reconciled. */
  targetPath: string;

  /**
   * Raw `descendantCount` field read from the target page in the pages
   * collection at accept time.
   *
   * Null when the target page could not be resolved (e.g. invalid-target or
   * bootstrap-not-done reject that happens before the findOne).
   *
   * Derive plannedPageCount as:
   *   (targetType === 'page') ? 1 : 1 + descendantCount
   */
  descendantCount: number | null;

  /**
   * Number of pages the orchestrator actually processed.
   * Defaults to 0 and is updated on orchestrator completion.
   */
  processedCount: number;

  /** Current lifecycle status of this reconcile record. */
  status: ReconcileStatus;

  /** Present only when status is 'rejected'. Describes why the request was rejected. */
  rejectReason: string | null;

  /** When the reconcile orchestrator started processing. Null until it transitions to running. */
  startedAt: Date | null;

  /** When the reconcile reached a terminal state (completed / failed / rejected). */
  completedAt: Date | null;

  /** Error message recorded when status is 'failed'. */
  lastError: string | null;
}

export interface VaultReconcileLogDocument
  extends IVaultReconcileLog,
    Document {}

export interface VaultReconcileLogModel
  extends Model<VaultReconcileLogDocument> {}

// ---------------------------------------------------------------------------
// Sub-schema for triggeredBy
// ---------------------------------------------------------------------------

const triggeredBySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    isAdmin: { type: Boolean, required: true },
  },
  { _id: false },
);

// ---------------------------------------------------------------------------
// Main schema
// ---------------------------------------------------------------------------

const vaultReconcileLogSchema = new Schema<
  VaultReconcileLogDocument,
  VaultReconcileLogModel
>(
  {
    reconcileId: { type: String, required: true },

    triggeredAt: { type: Date, required: true, default: () => new Date() },

    triggeredBy: { type: triggeredBySchema, required: true },

    targetType: {
      type: String,
      enum: ['page', 'sub-tree'] satisfies ReconcileTargetType[],
      required: true,
    },

    targetPath: { type: String, required: true },

    /**
     * descendantCount can be null for reject records where the target page
     * was never resolved (invalid-target / bootstrap-not-done).
     */
    descendantCount: { type: Number, default: null },

    processedCount: { type: Number, required: true, default: 0 },

    status: {
      type: String,
      enum: [
        'pending',
        'running',
        'completed',
        'failed',
        'rejected',
      ] satisfies ReconcileStatus[],
      required: true,
    },

    rejectReason: { type: String, default: null },

    startedAt: { type: Date, default: null },

    completedAt: { type: Date, default: null },

    lastError: { type: String, default: null },
  },
  {
    collection: 'vault_reconcile_log',
    // Disable automatic timestamps — triggeredAt / startedAt / completedAt are
    // managed explicitly with domain-specific semantics.
    timestamps: false,
  },
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// 1. Unique index on reconcileId — used as the external referenceable key.
vaultReconcileLogSchema.index({ reconcileId: 1 }, { unique: true });

// 2. TTL index on triggeredAt — documents are automatically removed after
//    RECONCILE_LOG_TTL_SECONDS. When config is wired in (task 3.3), replace
//    the constant with a config lookup and re-create the index.
vaultReconcileLogSchema.index(
  { triggeredAt: 1 },
  { expireAfterSeconds: RECONCILE_LOG_TTL_SECONDS },
);

// 3. Compound index: status + triggeredAt — supports history queries filtered
//    by status ordered by recency.
vaultReconcileLogSchema.index({ status: 1, triggeredAt: -1 });

// 4. Compound index: triggeredBy.userId + triggeredAt — supports per-user
//    history queries and the concurrency-check query pattern.
vaultReconcileLogSchema.index({ 'triggeredBy.userId': 1, triggeredAt: -1 });

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const VaultReconcileLog = getOrCreateModel<
  VaultReconcileLogDocument,
  VaultReconcileLogModel
>('VaultReconcileLog', vaultReconcileLogSchema);
