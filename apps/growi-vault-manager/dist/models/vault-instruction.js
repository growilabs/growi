import mongoose, { Schema } from 'mongoose';

// ---- Bulk-upsert entry sub-schema ----
const bulkUpsertEntrySchema = new Schema(
  {
    pageId: { type: String, required: true },
    pagePath: { type: String, required: true },
    revisionId: { type: String, required: true },
  },
  { _id: false },
);
// ---- Payload sub-schema ----
const payloadSchema = new Schema(
  {
    namespace: { type: String },
    pageId: { type: String },
    pagePath: { type: String },
    revisionId: { type: String },
    entries: { type: [bulkUpsertEntrySchema] },
    oldPrefix: { type: String },
    newPrefix: { type: String },
    fromNamespace: { type: String },
  },
  { _id: false },
);
// ---- Main schema ----
const vaultInstructionSchema = new Schema(
  {
    op: {
      type: String,
      required: true,
      enum: [
        'upsert',
        'bulk-upsert',
        'remove',
        'rename-prefix',
        'grant-change-prefix',
        'reset-all',
      ],
    },
    payload: { type: payloadSchema, required: true },
    issuedAt: { type: Date, required: true },
    processedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
  },
  {
    collection: 'vault_instructions',
    timestamps: false,
    // Disable version key; apps/app controls schema evolution
    versionKey: false,
  },
);
// ---- Indexes ----
/**
 * TTL index: processed documents expire 24 hours after processedAt.
 * Only fires when processedAt is non-null; null values are excluded from TTL eviction.
 */
vaultInstructionSchema.index(
  { processedAt: 1 },
  { expireAfterSeconds: 86400, sparse: true },
);
/**
 * Compound index for drain query: find unprocessed instructions ordered by issuedAt.
 * Pattern: find({ processedAt: null }).sort({ issuedAt: 1 })
 */
vaultInstructionSchema.index({ processedAt: 1, issuedAt: 1 });
// ---- Instance methods ----
/**
 * Marks this instruction as successfully processed by setting processedAt to now.
 * vault-manager calls this after VaultNamespaceBuilder.applyInstruction succeeds.
 */
vaultInstructionSchema.methods.markProcessed = async function () {
  await VaultInstructionModel.updateOne(
    { _id: this._id },
    { $set: { processedAt: new Date() } },
  );
};
/**
 * Records a processing failure: increments the attempts counter and stores
 * the error message. processedAt remains null so the instruction can be retried.
 */
vaultInstructionSchema.methods.recordFailure = async function (errorMessage) {
  await VaultInstructionModel.updateOne(
    { _id: this._id },
    {
      $inc: { attempts: 1 },
      $set: { lastError: errorMessage },
    },
  );
};
// ---- Static implementations ----
vaultInstructionSchema.statics.drainCursor = function () {
  return this.find({ processedAt: null }).sort({ issuedAt: 1 });
};
vaultInstructionSchema.statics.watchInserts = function (resumeToken) {
  const pipeline = [{ $match: { operationType: 'insert' } }];
  const options = resumeToken != null ? { resumeAfter: resumeToken } : {};
  // Access the underlying MongoDB native collection to open the change stream
  return this.collection.watch(pipeline, options);
};
vaultInstructionSchema.statics.setProcessedAt = async function (
  id,
  at = new Date(),
) {
  await this.updateOne({ _id: id }, { $set: { processedAt: at } });
};
vaultInstructionSchema.statics.appendFailure = async function (
  id,
  errorMessage,
) {
  await this.updateOne(
    { _id: id },
    { $inc: { attempts: 1 }, $set: { lastError: errorMessage } },
  );
};
// ---- Model export ----
/**
 * Mongoose model for the vault_instructions collection.
 * vault-manager has read access and limited write access
 * (processedAt / attempts / lastError only).
 */
export const VaultInstructionModel = mongoose.model(
  'VaultInstruction',
  vaultInstructionSchema,
);
//# sourceMappingURL=vault-instruction.js.map
