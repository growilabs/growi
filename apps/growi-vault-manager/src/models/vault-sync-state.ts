import mongoose, { type Document, type Model, Schema } from 'mongoose';

// ResumeToken is an opaque object from the MongoDB driver.
// We access it through mongoose.mongo (mongoose re-exports the mongodb driver)
// rather than importing 'mongodb' directly (not a direct dependency).
type ResumeToken = InstanceType<typeof mongoose.mongo.Binary> | object;

// ---- Interfaces ----

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

  // ---- vault-manager owned fields ----

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

  // ---- apps/app owned fields (read-only for vault-manager) ----

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

// ---- Model interface ----

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

// ---- Schema ----

const vaultSyncStateSchema = new Schema<
  IVaultSyncStateDocument,
  IVaultSyncStateModel
>(
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
vaultSyncStateSchema.statics.getSingleton = function (
  this: IVaultSyncStateModel,
): Promise<IVaultSyncState | null> {
  return this.findOne({ _id: 'singleton' }).lean<IVaultSyncState>().exec();
};

vaultSyncStateSchema.statics.saveResumeToken = async function (
  this: IVaultSyncStateModel,
  token: ResumeToken,
): Promise<void> {
  await this.updateOne(
    { _id: 'singleton' },
    { $set: { resumeToken: token } },
    { upsert: true },
  );
};

vaultSyncStateSchema.statics.touchLastProcessedAt = async function (
  this: IVaultSyncStateModel,
  at: Date = new Date(),
): Promise<void> {
  await this.updateOne(
    { _id: 'singleton' },
    { $set: { lastProcessedAt: at } },
    { upsert: true },
  );
};

vaultSyncStateSchema.statics.setWatcherInstanceId = async function (
  this: IVaultSyncStateModel,
  instanceId: string,
): Promise<void> {
  await this.updateOne(
    { _id: 'singleton' },
    { $set: { watcherInstanceId: instanceId } },
    { upsert: true },
  );
};

vaultSyncStateSchema.statics.updateWatcherFields = async function (
  this: IVaultSyncStateModel,
  fields: {
    resumeToken?: ResumeToken;
    lastProcessedAt?: Date;
    watcherInstanceId?: string;
  },
): Promise<void> {
  // Build the $set payload from only the provided fields to avoid overwriting
  // other vault-manager owned fields with undefined.
  const $set: Record<string, unknown> = {};
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
export const VaultSyncStateModel = mongoose.model<
  IVaultSyncStateDocument,
  IVaultSyncStateModel
>('VaultSyncState', vaultSyncStateSchema);

// Export the ResumeToken type alias for callers (e.g., VaultInstructionWatcher)
export type { ResumeToken };
