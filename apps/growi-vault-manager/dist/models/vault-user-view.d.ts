import type { Namespace } from '@growi/core/dist/interfaces/vault';
import { type Document, type Model, type Types } from 'mongoose';
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
/**
 * Mongoose model for the vault_user_views collection.
 * vault-manager is the sole owner: reads and writes are both permitted.
 */
export declare const VaultUserViewModel: IVaultUserViewModel;
