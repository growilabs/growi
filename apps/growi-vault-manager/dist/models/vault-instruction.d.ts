import type { VaultInstructionDoc } from '@growi/core/dist/interfaces/vault';
import mongoose, { type Document, type Model } from 'mongoose';
type ResumeToken = InstanceType<typeof mongoose.mongo.Binary> | object;
type ChangeStream = InstanceType<typeof mongoose.mongo.ChangeStream>;
/**
 * Extends VaultInstructionDoc with Mongoose Document methods.
 * vault-manager owns only processedAt / attempts / lastError writes.
 * apps/app is the write owner for all other fields.
 */
export interface IVaultInstructionDocument
  extends Omit<VaultInstructionDoc, '_id'>,
    Document {
  /** Mark this instruction as successfully processed. */
  markProcessed(): Promise<void>;
  /** Record a processing failure: increment attempts and store the error message. */
  recordFailure(errorMessage: string): Promise<void>;
}
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
/**
 * Mongoose model for the vault_instructions collection.
 * vault-manager has read access and limited write access
 * (processedAt / attempts / lastError only).
 */
export declare const VaultInstructionModel: IVaultInstructionModel;
export type { ChangeStream as VaultChangeStream, ResumeToken };
