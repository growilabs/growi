import type {
  VaultInstructionDoc,
  VaultInstructionOp,
  VaultInstructionPayload,
} from '@growi/core/dist/interfaces/vault';
import type { Document, Model } from 'mongoose';
import mongoose, { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

const { ObjectId } = mongoose.Schema.Types;

/**
 * Mongoose document type for vault_instructions collection.
 * apps/app is the write owner of this collection.
 * vault-manager reads documents and updates processedAt.
 *
 * Note: _id is typed as mongoose.Types.ObjectId (not string) because Mongoose
 * stores it as an ObjectId at runtime. The VaultInstructionDoc interface from
 * @growi/core uses string for cross-package portability (serialised form).
 */
export interface VaultInstructionDocument
  extends Omit<VaultInstructionDoc, '_id'>,
    Document {
  _id: mongoose.Types.ObjectId;
}

export interface VaultInstructionModel
  extends Model<VaultInstructionDocument> {}

/**
 * Sub-schema for the entries array used in bulk-upsert instructions.
 * Each entry identifies a single page to be synced.
 */
const bulkUpsertEntrySchema = new Schema(
  {
    pageId: { type: String, required: true },
    pagePath: { type: String, required: true },
    revisionId: { type: String, required: true },
  },
  { _id: false },
);

/**
 * Sub-schema for the payload embedded in each vault instruction.
 * All fields are optional — the applicable subset depends on the op type.
 */
const payloadSchema = new Schema<VaultInstructionPayload>(
  {
    /** Target namespace; undefined when op === 'reset-all'. */
    namespace: { type: String },
    /** Affected page identifier (upsert / remove). */
    pageId: { type: String },
    /** Affected page path (upsert / remove). */
    pagePath: { type: String },
    /** Revision to sync (upsert). */
    revisionId: { type: String },
    /** Entries for bulk-upsert instructions. */
    entries: { type: [bulkUpsertEntrySchema], default: undefined },
    /** Old path prefix for rename-prefix instructions. */
    oldPrefix: { type: String },
    /** New path prefix for rename-prefix instructions. */
    newPrefix: { type: String },
    /** Source namespace for grant-change-prefix instructions. */
    fromNamespace: { type: String },
  },
  { _id: false },
);

/**
 * Schema for the vault_instructions collection.
 *
 * Indexes:
 *   - Compound index { processedAt, issuedAt } — vault-manager uses this to
 *     fetch unprocessed instructions in issuance order.
 *   - TTL index on processedAt — processed instructions are automatically
 *     deleted after 24 h (86 400 s) to prevent unbounded collection growth.
 */
const vaultInstructionSchema = new Schema<
  VaultInstructionDocument,
  VaultInstructionModel
>(
  {
    op: {
      type: String,
      enum: [
        'upsert',
        'bulk-upsert',
        'remove',
        'rename-prefix',
        'grant-change-prefix',
        'reset-all',
      ] satisfies VaultInstructionOp[],
      required: true,
    },
    payload: { type: payloadSchema, required: true },
    issuedAt: { type: Date, required: true, default: () => new Date() },
    processedAt: { type: Date, default: null },
    attempts: { type: Number, required: true, default: 0 },
    lastError: { type: String, default: null },
  },
  {
    collection: 'vault_instructions',
    // Disable automatic timestamps — issuedAt is managed explicitly so that
    // vault-manager can rely on its semantics without being conflated with
    // Mongoose's built-in createdAt.
    timestamps: false,
  },
);

// Compound index used by vault-manager to fetch pending instructions in order.
vaultInstructionSchema.index({ processedAt: 1, issuedAt: 1 });

// TTL index: automatically expire processed instructions after 24 hours.
vaultInstructionSchema.index({ processedAt: 1 }, { expireAfterSeconds: 86400 });

export const VaultInstruction = getOrCreateModel<
  VaultInstructionDocument,
  VaultInstructionModel
>('VaultInstruction', vaultInstructionSchema);
