import type { Namespace } from '@growi/core/dist/interfaces/vault';
import mongoose, {
  type Document,
  type Model,
  Schema,
  type Types,
} from 'mongoose';

// ---- Interfaces ----

/**
 * A snapshot of namespace → commitOid versions captured when a view was composed.
 * VaultViewComposer compares this against current namespace states to determine
 * whether a cached view is still valid.
 */
export type SourceVersionMap = Record<Namespace, string>;

/**
 * Represents a per-user composed view cache document.
 * vault-manager owns this collection entirely.
 */
export interface IVaultUserView {
  /**
   * The GROWI user ObjectId as a string.
   * The unique index on userId allows at most one document per user.
   */
  readonly userId: string;
  /**
   * Git ref name for the composed view (e.g. 'user-<uid>-view').
   * Passed to git upload-pack as GIT_NAMESPACE.
   */
  readonly viewRef: string;
  /** 40-char SHA-1 OID of the commit at the tip of the view ref. */
  readonly viewCommitOid: string;
  /**
   * Root tree OID of the merged view tree.
   * Used by delta merge as a base when only a subset of source namespaces changed.
   */
  readonly mergedTreeOid: string;
  /**
   * Snapshot of namespace commitOids at compose time.
   * Used to detect staleness: if any value differs from vault_namespace_state,
   * the view must be recomposed.
   */
  readonly sourceVersions: SourceVersionMap;
  readonly composedAt: Date;
}

/**
 * Mongoose document type. _id is provided by Document; redeclared here only
 * for the ObjectId type — does not conflict because Document uses the same shape.
 */
export interface IVaultUserViewDocument extends IVaultUserView, Document {
  readonly _id: Types.ObjectId;
}

// ---- Model interface ----

export interface IVaultUserViewModel extends Model<IVaultUserViewDocument> {
  /**
   * Retrieves the cached view for the given userId.
   * Returns null when no view has been composed yet.
   */
  findByUserId(userId: string): Promise<IVaultUserView | null>;

  /**
   * Upserts the view cache for a user.
   * Overwrites all fields on conflict (same userId).
   */
  upsertView(
    userId: string,
    data: {
      viewRef: string;
      viewCommitOid: string;
      mergedTreeOid: string;
      sourceVersions: SourceVersionMap;
    },
  ): Promise<IVaultUserView>;

  /**
   * Removes all user view documents.
   * Called during reset-all instruction processing.
   */
  deleteAll(): Promise<void>;

  /**
   * Removes the shared anonymous-view record (`userId: null`) that
   * credential-less clones created. A no-op when it does not exist.
   */
  deleteAnonymous(): Promise<void>;
}

// ---- Schema ----

const vaultUserViewSchema = new Schema<
  IVaultUserViewDocument,
  IVaultUserViewModel
>(
  {
    userId: { type: String, required: true },
    viewRef: { type: String, required: true },
    viewCommitOid: { type: String, required: true },
    mergedTreeOid: { type: String, required: true },
    // Mixed type to allow arbitrary namespace keys; validation is at the service layer
    sourceVersions: { type: Schema.Types.Mixed, required: true, default: {} },
    composedAt: { type: Date, required: true, default: () => new Date() },
  },
  {
    collection: 'vault_user_views',
    versionKey: false,
    timestamps: false,
  },
);

// ---- Indexes ----

/**
 * Sparse unique index on userId: at most one view document per user.
 */
vaultUserViewSchema.index({ userId: 1 }, { unique: true, sparse: true });

// ---- Static implementations ----

vaultUserViewSchema.statics.findByUserId = function (
  this: IVaultUserViewModel,
  userId: string,
): Promise<IVaultUserView | null> {
  return this.findOne({ userId }).lean<IVaultUserView>().exec();
};

vaultUserViewSchema.statics.upsertView = function (
  this: IVaultUserViewModel,
  userId: string,
  data: {
    viewRef: string;
    viewCommitOid: string;
    mergedTreeOid: string;
    sourceVersions: SourceVersionMap;
  },
): Promise<IVaultUserView> {
  return this.findOneAndUpdate(
    { userId },
    {
      $set: {
        userId,
        viewRef: data.viewRef,
        viewCommitOid: data.viewCommitOid,
        mergedTreeOid: data.mergedTreeOid,
        sourceVersions: data.sourceVersions,
        composedAt: new Date(),
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
    },
  )
    .lean<IVaultUserView>()
    .then((doc) => {
      if (doc == null) {
        throw new Error(
          `VaultUserView upsert returned null for userId: ${userId}`,
        );
      }
      return doc;
    });
};

vaultUserViewSchema.statics.deleteAll = function (
  this: IVaultUserViewModel,
): Promise<void> {
  return this.deleteMany({}).then(() => {
    /* intentionally empty — caller only needs the settled signal */
  });
};

vaultUserViewSchema.statics.deleteAnonymous = function (
  this: IVaultUserViewModel,
): Promise<void> {
  return this.deleteMany({ userId: { $type: 'null' } }).then(() => {
    /* intentionally empty — caller only needs the settled signal */
  });
};

// ---- Model export ----

/**
 * Mongoose model for the vault_user_views collection.
 * vault-manager is the sole owner: reads and writes are both permitted.
 */
export const VaultUserViewModel = mongoose.model<
  IVaultUserViewDocument,
  IVaultUserViewModel
>('VaultUserView', vaultUserViewSchema);
