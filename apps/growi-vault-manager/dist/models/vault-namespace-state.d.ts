import type { Namespace } from '@growi/core/dist/interfaces/vault';
import { type Document, type Model, type Types } from 'mongoose';
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
/**
 * Mongoose model for the vault_namespace_state collection.
 * vault-manager is the sole owner: reads and writes are both permitted.
 */
export declare const VaultNamespaceStateModel: IVaultNamespaceStateModel;
