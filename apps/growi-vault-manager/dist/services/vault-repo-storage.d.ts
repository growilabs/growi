/**
 * VaultRepoStorage
 *
 * Abstracts all physical git-object and ref operations against the shared
 * bare repository.  Works on local filesystems, NFS, and GCP Filestore
 * (any POSIX-compliant storage that provides atomic rename semantics).
 *
 * Object I/O delegates to isomorphic-git; ref management uses plain Node.js
 * fs calls with an atomic tmpfile-then-rename pattern so that concurrent
 * readers always see a consistent ref value.
 *
 * GCSFuse and similar object-storage FUSE mounts are explicitly NOT supported
 * because they do not guarantee atomic rename semantics (requirement 9.5).
 */
/**
 * A single entry inside a git tree object.
 * Mirrors isomorphic-git's TreeEntry but restricted to blob and tree types
 * relevant to vault usage.
 */
export interface TreeEntry {
  /** '100644' for a regular blob; '040000' for a subtree. */
  readonly mode: string;
  /** The filename or directory name (not the full path). */
  readonly path: string;
  /** 40-character SHA-1 OID. */
  readonly oid: string;
  /** Object type. */
  readonly type: 'blob' | 'tree';
}
/**
 * Options passed when creating a commit object.
 */
export interface CommitOptions {
  /** OID of the root tree for this commit. */
  readonly tree: string;
  /** Parent commit OIDs (empty array for a root / squash commit). */
  readonly parents: ReadonlyArray<string>;
  /** Human-readable commit message. */
  readonly message: string;
  readonly author: {
    readonly name: string;
    readonly email: string;
    /** Unix timestamp in seconds. */
    readonly timestamp: number;
  };
  readonly committer: {
    readonly name: string;
    readonly email: string;
    /** Unix timestamp in seconds. */
    readonly timestamp: number;
  };
}
/**
 * Returns the absolute path to the bare repository.
 * Value is derived from process.env.VAULT_REPO_PATH at first call.
 */
export declare function getRepoPath(): string;
/**
 * Initialises the bare repository if it does not already exist.
 * Idempotent: calling this when the repo exists is a no-op.
 *
 * Corresponds to `git init --bare <repoPath>`.
 */
export declare function init(): Promise<void>;
/**
 * Writes blob content to the object pool and returns its OID.
 *
 * If a blob with the same OID already exists (content-addressed no-op),
 * isomorphic-git will simply overwrite the loose object with identical
 * bytes, which is functionally equivalent to a skip and does not produce
 * an error (requirement 9.3).
 *
 * @param content - Raw bytes to store as a git blob.
 * @returns 40-character SHA-1 OID.
 */
export declare function writeBlob(content: Buffer): Promise<string>;
/**
 * Writes a tree object to the object pool and returns its OID.
 *
 * @param entries - List of tree entries (blobs and subtrees).
 * @returns 40-character SHA-1 OID.
 */
export declare function writeTree(
  entries: ReadonlyArray<TreeEntry>,
): Promise<string>;
/**
 * Writes a commit object to the object pool and returns its OID.
 *
 * @param opts - Commit metadata and tree/parent references.
 * @returns 40-character SHA-1 OID.
 */
export declare function writeCommit(opts: CommitOptions): Promise<string>;
/**
 * Reads a tree object from the object pool.
 *
 * @param oid - OID of the tree (or a commit that will be peeled to its tree).
 * @returns Array of tree entries (blob and tree types only).
 */
export declare function readTree(
  oid: string,
): Promise<ReadonlyArray<TreeEntry>>;
/**
 * Updates a ref to point to newOid using an atomic tmpfile-then-rename.
 *
 * On POSIX systems, rename(2) is atomic when src and dst are on the same
 * filesystem.  This guarantees that a concurrent reader of the ref always
 * sees either the old OID or the new OID, never a partial write.
 *
 * @param refPath - Ref path relative to the git directory
 *                  (e.g. 'refs/namespaces/public/refs/heads/main').
 * @param newOid  - 40-character SHA-1 OID that the ref should point to.
 */
export declare function updateRef(
  refPath: string,
  newOid: string,
): Promise<void>;
/**
 * Reads the OID stored in a ref.
 *
 * @param refPath - Ref path relative to the git directory.
 * @returns 40-character OID, or null if the ref does not exist.
 */
export declare function readRef(refPath: string): Promise<string | null>;
/**
 * Deletes a ref from the repository.
 * If the ref does not exist, this is a no-op (idempotent).
 *
 * @param refPath - Ref path relative to the git directory.
 */
export declare function deleteRef(refPath: string): Promise<void>;
