import mongoose, { type Document, type Model } from 'mongoose';
type ResumeToken = InstanceType<typeof mongoose.mongo.Binary> | object;
/**
 * Bootstrap states written by apps/app VaultBootstrapper.
 * vault-manager reads these but never writes them.
 */
export type BootstrapState = 'pending' | 'running' | 'done' | 'failed';
/**
 * The singleton document stored in vault_sync_state.
 * Fields are partitioned by write owner to enforce boundary discipline:
 *   - vault-manager owns: resumeToken, lastProcessedAt, watcherInstanceId
 *   - apps/app owns:      all bootstrap* fields (read-only from vault-manager)
 */
export interface IVaultSyncState {
  /** Singleton document identifier — always 'singleton'. */
  readonly _id: string;
  /**
   * MongoDB change stream resume token.
   * Persisted after each event so a restart can resume without missing events
   * (at-least-once delivery guarantee).
   */
  readonly resumeToken: ResumeToken | null;
  /** Timestamp of the last successfully processed instruction. */
  readonly lastProcessedAt: Date | null;
  /**
   * Unique identifier for the currently running watcher instance.
   * Set on startup to detect multi-pod races (MVP: single pod, field provides
   * observability for debugging accidental multi-start scenarios).
   */
  readonly watcherInstanceId: string | null;
  readonly bootstrapState: BootstrapState | null;
  readonly bootstrapCursor: string | null;
  readonly bootstrapStartedAt: Date | null;
  readonly bootstrapCompletedAt: Date | null;
  readonly bootstrapTotalEstimated: number | null;
  readonly bootstrapProcessed: number;
}
/**
 * Mongoose document type. Omit _id from IVaultSyncState so that
 * Document's _id typing takes precedence and avoids TS2320.
 */
export interface IVaultSyncStateDocument
  extends Omit<IVaultSyncState, '_id'>,
    Document {}
export interface IVaultSyncStateModel extends Model<IVaultSyncStateDocument> {
  /**
   * Fetches the singleton document.
   * Returns null if the document does not exist yet.
   */
  getSingleton(): Promise<IVaultSyncState | null>;
  /**
   * Persists a new resume token after an event is processed.
   * Only touches the resumeToken field.
   */
  saveResumeToken(token: ResumeToken): Promise<void>;
  /**
   * Updates lastProcessedAt to now (or a supplied timestamp).
   */
  touchLastProcessedAt(at?: Date): Promise<void>;
  /**
   * Sets watcherInstanceId on startup for multi-pod race detection.
   */
  setWatcherInstanceId(instanceId: string): Promise<void>;
  /**
   * Atomically updates all three vault-manager owned fields in one round-trip.
   * Creates the singleton document if it does not exist.
   */
  updateWatcherFields(fields: {
    resumeToken?: ResumeToken;
    lastProcessedAt?: Date;
    watcherInstanceId?: string;
  }): Promise<void>;
}
/**
 * Mongoose model for the vault_sync_state collection (singleton document).
 * vault-manager writes: resumeToken, lastProcessedAt, watcherInstanceId.
 * apps/app writes: all bootstrap* fields.
 * Both sides may read everything.
 */
export declare const VaultSyncStateModel: IVaultSyncStateModel;
export type { ResumeToken };
