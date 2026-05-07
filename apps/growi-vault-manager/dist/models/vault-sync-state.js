import mongoose, { Schema } from 'mongoose';

// ---- Schema ----
const vaultSyncStateSchema = new Schema(
  {
    // Singleton ID — always 'singleton'; enforced by the upsert filter
    _id: { type: String },
    // vault-manager owned fields
    resumeToken: { type: Schema.Types.Mixed, default: null },
    lastProcessedAt: { type: Date, default: null },
    watcherInstanceId: { type: String, default: null },
    // apps/app owned fields — vault-manager declares them for read access only
    bootstrapState: {
      type: String,
      enum: ['pending', 'running', 'done', 'failed', null],
      default: null,
    },
    bootstrapCursor: { type: String, default: null },
    bootstrapStartedAt: { type: Date, default: null },
    bootstrapCompletedAt: { type: Date, default: null },
    bootstrapTotalEstimated: { type: Number, default: null },
    bootstrapProcessed: { type: Number, default: 0 },
  },
  {
    collection: 'vault_sync_state',
    versionKey: false,
    timestamps: false,
  },
);
// ---- Static implementations ----
// Not async: .lean() returns a Promise — no await needed, return directly
vaultSyncStateSchema.statics.getSingleton = function () {
  return this.findOne({ _id: 'singleton' }).lean().exec();
};
vaultSyncStateSchema.statics.saveResumeToken = async function (token) {
  await this.updateOne(
    { _id: 'singleton' },
    { $set: { resumeToken: token } },
    { upsert: true },
  );
};
vaultSyncStateSchema.statics.touchLastProcessedAt = async function (
  at = new Date(),
) {
  await this.updateOne(
    { _id: 'singleton' },
    { $set: { lastProcessedAt: at } },
    { upsert: true },
  );
};
vaultSyncStateSchema.statics.setWatcherInstanceId = async function (
  instanceId,
) {
  await this.updateOne(
    { _id: 'singleton' },
    { $set: { watcherInstanceId: instanceId } },
    { upsert: true },
  );
};
vaultSyncStateSchema.statics.updateWatcherFields = async function (fields) {
  // Build the $set payload from only the provided fields to avoid overwriting
  // other vault-manager owned fields with undefined.
  const $set = {};
  if (fields.resumeToken !== undefined) {
    $set.resumeToken = fields.resumeToken;
  }
  if (fields.lastProcessedAt !== undefined) {
    $set.lastProcessedAt = fields.lastProcessedAt;
  }
  if (fields.watcherInstanceId !== undefined) {
    $set.watcherInstanceId = fields.watcherInstanceId;
  }
  if (Object.keys($set).length === 0) {
    return;
  }
  await this.updateOne({ _id: 'singleton' }, { $set }, { upsert: true });
};
// ---- Model export ----
/**
 * Mongoose model for the vault_sync_state collection (singleton document).
 * vault-manager writes: resumeToken, lastProcessedAt, watcherInstanceId.
 * apps/app writes: all bootstrap* fields.
 * Both sides may read everything.
 */
export const VaultSyncStateModel = mongoose.model(
  'VaultSyncState',
  vaultSyncStateSchema,
);
//# sourceMappingURL=vault-sync-state.js.map
