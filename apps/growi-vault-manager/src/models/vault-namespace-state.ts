import type { Namespace } from '@growi/core/dist/interfaces/vault';
import mongoose, {
  type Document,
  type Model,
  Schema,
  type Types,
} from 'mongoose';

// ---- Interfaces ----

/**
 * Represents the current HEAD state of a single vault namespace.
 * vault-manager owns this collection entirely (read and write).
 */
export interface IVaultNamespaceState {
  readonly namespace: Namespace;
  /** 40-character SHA-1 OID of the current HEAD commit for this namespace. */
  readonly commitOid: string;
  /**
   * Monotonically increasing counter incremented on every commit.
   * Used by VaultViewComposer to detect whether a namespace has changed
   * since a user view was last composed (cache invalidation key).
   */
  readonly version: number;
  readonly updatedAt: Date;
}

/**
 * Mongoose document type. _id is provided by Document; not redeclared here
 * to avoid the TS2320 "not identical" conflict.
 */
export interface IVaultNamespaceStateDocument
  extends IVaultNamespaceState,
    Document {
  readonly _id: Types.ObjectId;
}

// ---- Model interface ----

export interface IVaultNamespaceStateModel
  extends Model<IVaultNamespaceStateDocument> {
  /**
   * Upserts the namespace state, atomically incrementing version.
   * Returns the updated document as a plain object.
   *
   * @param namespace - The namespace identifier (e.g. 'public', 'group-<gid>').
   * @param commitOid - The new HEAD commit OID (40-char SHA-1).
   */
  upsertNamespace(
    namespace: Namespace,
    commitOid: string,
  ): Promise<IVaultNamespaceState>;

  /**
   * Retrieves the current state for a namespace.
   * Returns null if the namespace has no commits yet.
   */
  findByNamespace(namespace: Namespace): Promise<IVaultNamespaceState | null>;

  /**
   * Builds a map of namespace → commitOid for the given namespace list.
   * Missing namespaces (no commits yet) are omitted from the returned map.
   */
  getCommitOidMap(
    namespaces: ReadonlyArray<Namespace>,
  ): Promise<Record<Namespace, string>>;

  /**
   * Removes all namespace state documents.
   * Called during reset-all instruction processing.
   */
  deleteAll(): Promise<void>;
}

// ---- Schema ----

const vaultNamespaceStateSchema = new Schema<
  IVaultNamespaceStateDocument,
  IVaultNamespaceStateModel
>(
  {
    namespace: { type: String, required: true },
    commitOid: { type: String, required: true },
    version: { type: Number, required: true, default: 0 },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  {
    collection: 'vault_namespace_state',
    versionKey: false,
    timestamps: false,
  },
);

// ---- Indexes ----

/**
 * Unique index on namespace ensures one doc per namespace.
 * Also serves as the lookup key for VaultViewComposer.
 */
vaultNamespaceStateSchema.index({ namespace: 1 }, { unique: true });

// ---- Static implementations ----

vaultNamespaceStateSchema.statics.upsertNamespace = function (
  this: IVaultNamespaceStateModel,
  namespace: Namespace,
  commitOid: string,
): Promise<IVaultNamespaceState> {
  return this.findOneAndUpdate(
    { namespace },
    {
      $set: { commitOid, updatedAt: new Date() },
      // Increment version on every update so VaultViewComposer can detect
      // changes without comparing the full commitOid.
      $inc: { version: 1 },
      // On first insert, set the namespace field (not covered by $set filter).
      $setOnInsert: { namespace },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
    },
  )
    .lean<IVaultNamespaceState>()
    .then((doc) => {
      if (doc == null) {
        // findOneAndUpdate with upsert:true + new:true should never return null
        throw new Error(
          `VaultNamespaceState upsert returned null for namespace: ${namespace}`,
        );
      }
      return doc;
    });
};

vaultNamespaceStateSchema.statics.findByNamespace = function (
  this: IVaultNamespaceStateModel,
  namespace: Namespace,
): Promise<IVaultNamespaceState | null> {
  return this.findOne({ namespace }).lean<IVaultNamespaceState>().exec();
};

vaultNamespaceStateSchema.statics.getCommitOidMap = function (
  this: IVaultNamespaceStateModel,
  namespaces: ReadonlyArray<Namespace>,
): Promise<Record<Namespace, string>> {
  return this.find(
    { namespace: { $in: namespaces } },
    { namespace: 1, commitOid: 1 },
  )
    .lean<Array<{ namespace: Namespace; commitOid: string }>>()
    .then((docs) =>
      docs.reduce<Record<Namespace, string>>((acc, doc) => {
        acc[doc.namespace] = doc.commitOid;
        return acc;
      }, {}),
    );
};

vaultNamespaceStateSchema.statics.deleteAll = function (
  this: IVaultNamespaceStateModel,
): Promise<void> {
  // deleteMany returns a DeleteResult; map to void so callers get a clean Promise<void>
  return this.deleteMany({}).then(() => {
    /* intentionally empty — caller only needs the settled signal */
  });
};

// ---- Model export ----

/**
 * Mongoose model for the vault_namespace_state collection.
 * vault-manager is the sole owner: reads and writes are both permitted.
 */
export const VaultNamespaceStateModel = mongoose.model<
  IVaultNamespaceStateDocument,
  IVaultNamespaceStateModel
>('VaultNamespaceState', vaultNamespaceStateSchema);
