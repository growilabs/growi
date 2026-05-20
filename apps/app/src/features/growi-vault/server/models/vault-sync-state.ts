import type mongoose from 'mongoose';
import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

/**
 * Bootstrap lifecycle states managed by apps/app (VaultBootstrapper).
 *
 * States added in resilience phase (requirements 1.11, 1.12):
 *   verifying — post-sync completeness check in progress
 *   retrying  — waiting for the next automatic retry after a transient failure
 *   escalated — retry budget exhausted; manual intervention required
 */
export type BootstrapState =
  | 'pending'
  | 'running'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'retrying'
  | 'escalated';

/**
 * Plain interface for the vault_sync_state singleton document.
 *
 * Field ownership:
 *   - bootstrap* fields — owned and written by apps/app (VaultBootstrapper)
 *   - drift* fields     — owned and written by apps/app (DriftSweeper)
 *   - resumeToken / lastProcessedAt / watcherInstanceId — owned and written by
 *     vault-manager; apps/app reads these fields but MUST NOT write them.
 */
export interface IVaultSyncState {
  /** Singleton document identifier. Always 'singleton'. */
  _id: string;

  // -------------------------------------------------------------------------
  // apps/app owned fields (VaultBootstrapper writes these)
  // -------------------------------------------------------------------------

  /** Current phase of the bootstrap process. */
  bootstrapState: BootstrapState;

  /** The _id of the last page processed during bootstrap (used for resume). Null until bootstrap starts. */
  bootstrapCursor: mongoose.Types.ObjectId | null;

  /** When the current (or most recent) bootstrap run started. */
  bootstrapStartedAt: Date | null;

  /** When the most recent successful bootstrap completed. */
  bootstrapCompletedAt: Date | null;

  /** Estimated total number of pages to process, set at bootstrap start. */
  bootstrapTotalEstimated: number | null;

  /** Number of pages processed so far in the current bootstrap run. */
  bootstrapProcessed: number;

  /**
   * Error message recorded when the most recent bootstrap run transitioned to
   * 'failed'. Cleared (set to null) when a new run starts. Surfaced to the
   * admin UI so operators can diagnose failures without trawling logs.
   */
  bootstrapLastError: string | null;

  /**
   * Unique identifier of the running bootstrapper instance.
   * Used for distributed lock / heartbeat detection (requirement 3.5).
   */
  bootstrapInstanceId: string | null;

  /**
   * Timestamp of the last heartbeat written by the active bootstrapper instance.
   * A stale heartbeat indicates a crashed or dead instance (requirement 3.5).
   */
  bootstrapHeartbeatAt: Date | null;

  /**
   * Source that triggered the most recent bootstrap run.
   * Helps diagnose unexpected re-runs (requirements 5.1, 5.2).
   */
  bootstrapLastTriggerSource: 'env-true' | 'env-force' | 'admin-ui' | null;

  /**
   * Number of automatic retries attempted for the current failure sequence.
   * Reset to 0 when bootstrap succeeds (requirements 1.11, 1.12).
   */
  bootstrapRetryAttempts: number;

  /**
   * Scheduled time for the next automatic retry.
   * Null when no retry is pending (requirements 1.11, 1.12).
   */
  bootstrapRetryNextAt: Date | null;

  /**
   * True when the retry sequence has been deliberately aborted (e.g. escalated
   * state reached). Prevents further automatic retries (requirements 1.11, 1.12).
   */
  bootstrapRetryAborted: boolean;

  /**
   * Timestamp of the most recent post-sync completeness check (requirement 1.12).
   */
  bootstrapCompletenessLastCheckedAt: Date | null;

  /**
   * Result of the most recent completeness check: 'ok' or 'failed' (requirement 1.12).
   */
  bootstrapCompletenessLastResult: 'ok' | 'failed' | null;

  /**
   * The maximum page _id seen in the change-stream snapshot taken at bootstrap
   * start. Used to bound which pages the completeness check must verify (requirement 1.12).
   */
  bootstrapStreamSnapshotMaxId: mongoose.Types.ObjectId | null;

  // -------------------------------------------------------------------------
  // apps/app owned fields (DriftSweeper writes these — requirement 5.3)
  // -------------------------------------------------------------------------

  /**
   * High-watermark timestamp for drift detection; pages modified before this
   * point have already been reconciled.
   */
  driftLastWatermark: Date | null;

  /** Timestamp of the most recent drift sweep execution. */
  driftLastSweepAt: Date | null;

  /**
   * Cumulative count of drift events detected since the process last started.
   * Reset on restart (in-memory semantics reflected here for persistence).
   */
  driftDetectedSinceBoot: number;

  /**
   * Cumulative count of repair instructions emitted since the process last started.
   */
  driftRepairsEmittedSinceBoot: number;

  /**
   * Error message from the most recent failed drift sweep.
   * Null when last sweep succeeded.
   */
  driftLastError: string | null;

  // -------------------------------------------------------------------------
  // vault-manager owned fields (apps/app reads only)
  // -------------------------------------------------------------------------

  /**
   * MongoDB change stream resume token stored by vault-manager so that it can
   * resume watching vault_instructions after a restart without missing events.
   * apps/app MUST NOT write this field.
   */
  resumeToken: Record<string, unknown> | null;

  /**
   * Timestamp of the most recently processed vault_instruction document.
   * Set by vault-manager after each successful processing cycle.
   * apps/app MUST NOT write this field.
   */
  lastProcessedAt: Date | null;

  /**
   * Unique identifier of the vault-manager instance that is currently watching
   * the change stream. Used to detect stale watchers on restart.
   * apps/app MUST NOT write this field.
   */
  watcherInstanceId: string | null;
}

export interface VaultSyncStateDocument extends IVaultSyncState, Document {
  _id: string;
}

export interface VaultSyncStateModel extends Model<VaultSyncStateDocument> {}

/**
 * Schema for the vault_sync_state collection.
 *
 * This collection always contains exactly one document with _id === 'singleton'.
 * The singleton is upserted on first use; no additional indexes are required
 * beyond the primary key.
 */
const vaultSyncStateSchema = new Schema<
  VaultSyncStateDocument,
  VaultSyncStateModel
>(
  {
    _id: { type: String, default: 'singleton' },

    // apps/app owned fields — bootstrap lifecycle
    bootstrapState: {
      type: String,
      enum: [
        'pending',
        'running',
        'verifying',
        'done',
        'failed',
        'retrying',
        'escalated',
      ] satisfies BootstrapState[],
      required: true,
      default: 'pending',
    },
    bootstrapCursor: { type: Schema.Types.ObjectId, default: null },
    bootstrapStartedAt: { type: Date, default: null },
    bootstrapCompletedAt: { type: Date, default: null },
    bootstrapTotalEstimated: { type: Number, default: null },
    bootstrapProcessed: { type: Number, required: true, default: 0 },
    bootstrapLastError: { type: String, default: null },

    // apps/app owned fields — resilience additions (requirements 3.5, 5.1, 5.2, 5.3)
    bootstrapInstanceId: { type: String, default: null },
    bootstrapHeartbeatAt: { type: Date, default: null },
    bootstrapLastTriggerSource: {
      type: String,
      enum: ['env-true', 'env-force', 'admin-ui', null],
      default: null,
    },
    bootstrapRetryAttempts: { type: Number, required: true, default: 0 },
    bootstrapRetryNextAt: { type: Date, default: null },
    bootstrapRetryAborted: { type: Boolean, required: true, default: false },
    bootstrapCompletenessLastCheckedAt: { type: Date, default: null },
    bootstrapCompletenessLastResult: {
      type: String,
      enum: ['ok', 'failed', null],
      default: null,
    },
    bootstrapStreamSnapshotMaxId: {
      type: Schema.Types.ObjectId,
      default: null,
    },

    // apps/app owned fields — drift sweeper (requirement 5.3)
    driftLastWatermark: { type: Date, default: null },
    driftLastSweepAt: { type: Date, default: null },
    driftDetectedSinceBoot: { type: Number, required: true, default: 0 },
    driftRepairsEmittedSinceBoot: { type: Number, required: true, default: 0 },
    driftLastError: { type: String, default: null },

    // vault-manager owned fields (read-only for apps/app)
    resumeToken: { type: Schema.Types.Mixed, default: null },
    lastProcessedAt: { type: Date, default: null },
    watcherInstanceId: { type: String, default: null },
  },
  {
    collection: 'vault_sync_state',
    // Disable automatic timestamps — this document is a long-lived singleton
    // and Mongoose timestamps would create misleading createdAt/updatedAt fields.
    timestamps: false,
  },
);

export const VaultSyncState = getOrCreateModel<
  VaultSyncStateDocument,
  VaultSyncStateModel
>('VaultSyncState', vaultSyncStateSchema);
