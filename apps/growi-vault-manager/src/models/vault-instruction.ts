import type {
  VaultInstructionDoc,
  VaultInstructionOp,
  VaultInstructionPayload,
} from '@growi/core/dist/interfaces/vault';
import mongoose, { type Document, type Model, Schema } from 'mongoose';

// Use ResumeToken and ChangeStream types re-exported through mongoose.mongo (mongodb v4)
type ResumeToken = InstanceType<typeof mongoose.mongo.Binary> | object;
type ChangeStream = InstanceType<typeof mongoose.mongo.ChangeStream>;

// ---- Mongoose document interface ----

/**
 * Extends VaultInstructionDoc with Mongoose Document methods.
 * vault-manager owns only processedAt / attempts / lastError writes.
 * apps/app is the write owner for all other fields.
 */
export interface IVaultInstructionDocument
  // Omit _id from VaultInstructionDoc so Mongoose Document's _id takes precedence
  extends Omit<VaultInstructionDoc, '_id'>,
    Document {
  /** Mark this instruction as successfully processed. */
  markProcessed(): Promise<void>;
  /** Record a processing failure: increment attempts and store the error message. */
  recordFailure(errorMessage: string): Promise<void>;
}

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

const payloadSchema = new Schema<VaultInstructionPayload>(
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

// ---- Model interface ----

export interface IVaultInstructionModel
  extends Model<IVaultInstructionDocument> {
  /**
   * Returns a Mongoose Query for all unprocessed instructions ordered by issuedAt.
   * Used by VaultInstructionWatcher during the startup drain phase.
   */
  drainCursor(): ReturnType<IVaultInstructionModel['find']>;

  /**
   * Opens a MongoDB change stream restricted to insert operations on the
   * vault_instructions collection. The caller supplies an optional resumeToken
   * from vault_sync_state so that events missed during downtime are replayed.
   */
  watchInserts(resumeToken?: ResumeToken): ChangeStream;

  /**
   * Updates processedAt for the given document _id.
   * Preferred when the caller does not hold the document instance.
   */
  setProcessedAt(id: string, at?: Date): Promise<void>;

  /**
   * Increments attempts and records lastError for the given document _id.
   */
  appendFailure(id: string, errorMessage: string): Promise<void>;
}

// ---- Main schema ----

const vaultInstructionSchema = new Schema<
  IVaultInstructionDocument,
  IVaultInstructionModel
>(
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
      ] satisfies VaultInstructionOp[],
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
vaultInstructionSchema.methods.markProcessed = async function (
  this: IVaultInstructionDocument,
): Promise<void> {
  await VaultInstructionModel.updateOne(
    { _id: this._id },
    { $set: { processedAt: new Date() } },
  );
};

/**
 * Records a processing failure: increments the attempts counter and stores
 * the error message. processedAt remains null so the instruction can be retried.
 */
vaultInstructionSchema.methods.recordFailure = async function (
  this: IVaultInstructionDocument,
  errorMessage: string,
): Promise<void> {
  await VaultInstructionModel.updateOne(
    { _id: this._id },
    {
      $inc: { attempts: 1 },
      $set: { lastError: errorMessage },
    },
  );
};

// ---- Static implementations ----

vaultInstructionSchema.statics.drainCursor = function (
  this: IVaultInstructionModel,
) {
  return this.find({ processedAt: null }).sort({ issuedAt: 1 });
};

vaultInstructionSchema.statics.watchInserts = function (
  this: IVaultInstructionModel,
  resumeToken?: ResumeToken,
): ChangeStream {
  const pipeline = [{ $match: { operationType: 'insert' } }];
  const options =
    resumeToken != null ? { resumeAfter: resumeToken as object } : {};
  // Access the underlying MongoDB native collection to open the change stream
  return this.collection.watch(pipeline, options) as unknown as ChangeStream;
};

vaultInstructionSchema.statics.setProcessedAt = async function (
  this: IVaultInstructionModel,
  id: string,
  at: Date = new Date(),
): Promise<void> {
  await this.updateOne({ _id: id }, { $set: { processedAt: at } });
};

vaultInstructionSchema.statics.appendFailure = async function (
  this: IVaultInstructionModel,
  id: string,
  errorMessage: string,
): Promise<void> {
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
export const VaultInstructionModel = mongoose.model<
  IVaultInstructionDocument,
  IVaultInstructionModel
>('VaultInstruction', vaultInstructionSchema);

// Re-export the ResumeToken type alias for callers (e.g., VaultInstructionWatcher)
export type { ChangeStream as VaultChangeStream, ResumeToken };
