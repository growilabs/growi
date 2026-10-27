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
 * Represents a per-user (or anonymous) composed view cache document.
 * vault-manager owns this collection entirely.
 */
export interface IVaultUserView {
  /**
   * The GROWI user ObjectId as a string, or null for the anonymous singleton view.
   * The sparse unique index on userId allows at most one document per user,
   * with the null entry being the single anonymous row.
   */
  readonly userId: string | null;
  /**
   * Git ref name for the composed view (e.g. 'user-<uid>-view' or 'anonymous-view').
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
   * Retrieves the cached view for the given userId (null = anonymous).
   * Returns null when no view has been composed yet.
   */
  findByUserId(userId: string | null): Promise<IVaultUserView | null>;

  /**
   * Upserts the view cache for a user.
   * Overwrites all fields on conflict (same userId).
   */
  upsertView(
    userId: string | null,
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
}

// ---- Schema ----

const vaultUserViewSchema = new Schema<
  IVaultUserViewDocument,
  IVaultUserViewModel
>(
  {
    // null represents the anonymous singleton view
    userId: { type: String, default: null },
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
 * Sparse unique index on userId:
 * - Unique: at most one view document per user.
 * - Sparse: null values are excluded from the uniqueness constraint,
 *   which allows the single anonymous row (userId: null) to coexist with
 *   user-specific rows without violating uniqueness.
 */
vaultUserViewSchema.index({ userId: 1 }, { unique: true, sparse: true });

// ---- Static implementations ----

vaultUserViewSchema.statics.findByUserId = function (
  this: IVaultUserViewModel,
  userId: string | null,
): Promise<IVaultUserView | null> {
  // Explicit null match: sparse index excludes null from the B-tree, but
  // Mongoose falls back to a collection scan and still finds the document.
  return this.findOne({ userId }).lean<IVaultUserView>().exec();
};

vaultUserViewSchema.statics.upsertView = function (
  this: IVaultUserViewModel,
  userId: string | null,
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
          `VaultUserView upsert returned null for userId: ${userId ?? 'anonymous'}`,
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

// ---- Model export ----

/**
 * Mongoose model for the vault_user_views collection.
 * vault-manager is the sole owner: reads and writes are both permitted.
 */
export const VaultUserViewModel = mongoose.model<
  IVaultUserViewDocument,
  IVaultUserViewModel
>('VaultUserView', vaultUserViewSchema);
