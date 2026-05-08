import type mongoose from 'mongoose';
import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

/**
 * Bootstrap lifecycle states managed by apps/app (VaultBootstrapper).
 */
export type BootstrapState = 'pending' | 'running' | 'done' | 'failed';

/**
 * Plain interface for the vault_sync_state singleton document.
 *
 * Field ownership:
 *   - bootstrap* fields — owned and written by apps/app (VaultBootstrapper)
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

    // apps/app owned fields
    bootstrapState: {
      type: String,
      enum: ['pending', 'running', 'done', 'failed'] satisfies BootstrapState[],
      required: true,
      default: 'pending',
    },
    bootstrapCursor: { type: Schema.Types.ObjectId, default: null },
    bootstrapStartedAt: { type: Date, default: null },
    bootstrapCompletedAt: { type: Date, default: null },
    bootstrapTotalEstimated: { type: Number, default: null },
    bootstrapProcessed: { type: Number, required: true, default: 0 },
    bootstrapLastError: { type: String, default: null },

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
