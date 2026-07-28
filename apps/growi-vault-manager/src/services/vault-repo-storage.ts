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

import fs from 'node:fs';
import path from 'node:path';
import type { TreeEntry as GitTreeEntry } from 'isomorphic-git';
import git from 'isomorphic-git';

// ---------------------------------------------------------------------------
// Type re-exports (kept local to avoid coupling to isomorphic-git's types)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the bare repo path from the environment variable
 * VAULT_REPO_PATH, falling back to '/data/vault-repo.git'.
 */
function resolveRepoPath(): string {
  return process.env.VAULT_REPO_PATH ?? '/data/vault-repo.git';
}

/**
 * Converts a TreeEntry (vault-local type) to the isomorphic-git TreeEntry
 * format accepted by writeTree.
 */
function toGitTreeEntry(entry: TreeEntry): GitTreeEntry {
  return {
    mode: entry.mode,
    path: entry.path,
    oid: entry.oid,
    type: entry.type,
  };
}

/**
 * Converts an isomorphic-git TreeEntry to the vault-local TreeEntry type.
 * Only blob and tree types are expected; 'commit' (submodule) entries are
 * filtered out by callers.
 */
function fromGitTreeEntry(entry: GitTreeEntry): TreeEntry {
  if (entry.type !== 'blob' && entry.type !== 'tree') {
    throw new Error(
      `Unexpected tree entry type '${entry.type}' for path '${entry.path}'`,
    );
  }
  return {
    mode: entry.mode,
    path: entry.path,
    oid: entry.oid,
    type: entry.type,
  };
}

// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------

/** Cached repo path — resolved once at first call and reused. */
let _repoPath: string | undefined;

/**
 * Returns the absolute path to the bare repository.
 * Value is derived from process.env.VAULT_REPO_PATH at first call.
 */
export function getRepoPath(): string {
  if (_repoPath == null) {
    _repoPath = resolveRepoPath();
  }
  return _repoPath;
}

/**
 * Initialises the bare repository if it does not already exist.
 * Idempotent: calling this when the repo exists is a no-op.
 *
 * Corresponds to `git init --bare <repoPath>`.
 */
export async function init(): Promise<void> {
  const repoPath = getRepoPath();

  // Check whether the repo already looks initialised by testing for the
  // presence of the 'HEAD' file, which git init always creates.
  const headFile = path.join(repoPath, 'HEAD');
  if (
    await fs.promises
      .access(headFile)
      .then(() => true)
      .catch(() => false)
  ) {
    // Already initialised — nothing to do.
    return;
  }

  // Ensure the parent directory exists before initialising.
  await fs.promises.mkdir(repoPath, { recursive: true });

  await git.init({
    fs,
    gitdir: repoPath,
    bare: true,
    defaultBranch: 'main',
  });
}

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
export function writeBlob(content: Buffer): Promise<string> {
  const repoPath = getRepoPath();
  return git.writeBlob({
    fs,
    gitdir: repoPath,
    blob: content,
  });
}

/**
 * Writes a tree object to the object pool and returns its OID.
 *
 * @param entries - List of tree entries (blobs and subtrees).
 * @returns 40-character SHA-1 OID.
 */
export function writeTree(entries: ReadonlyArray<TreeEntry>): Promise<string> {
  const repoPath = getRepoPath();
  return git.writeTree({
    fs,
    gitdir: repoPath,
    tree: entries.map(toGitTreeEntry),
  });
}

/**
 * Writes a commit object to the object pool and returns its OID.
 *
 * @param opts - Commit metadata and tree/parent references.
 * @returns 40-character SHA-1 OID.
 */
export function writeCommit(opts: CommitOptions): Promise<string> {
  const repoPath = getRepoPath();

  // timezoneOffset is expressed in minutes west of UTC.
  // Using 0 (UTC) keeps commit timestamps portable across environments.
  const timezoneOffset = 0;

  return git.writeCommit({
    fs,
    gitdir: repoPath,
    commit: {
      message: opts.message,
      tree: opts.tree,
      parent: [...opts.parents],
      author: { ...opts.author, timezoneOffset },
      committer: { ...opts.committer, timezoneOffset },
    },
  });
}

/**
 * Reads a tree object from the object pool.
 *
 * @param oid - OID of the tree (or a commit that will be peeled to its tree).
 * @returns Array of tree entries (blob and tree types only).
 */
export async function readTree(oid: string): Promise<ReadonlyArray<TreeEntry>> {
  const repoPath = getRepoPath();
  const result = await git.readTree({
    fs,
    gitdir: repoPath,
    oid,
  });
  return result.tree
    .filter((e) => e.type === 'blob' || e.type === 'tree')
    .map(fromGitTreeEntry);
}

// ---------------------------------------------------------------------------
// Ref operations (POSIX atomic rename)
// ---------------------------------------------------------------------------

/**
 * Resolves the filesystem path of a ref inside the bare repository.
 *
 * For example, 'refs/namespaces/public/refs/heads/main' becomes
 * '<repoPath>/refs/namespaces/public/refs/heads/main'.
 */
function refFilePath(refPath: string): string {
  return path.join(getRepoPath(), refPath);
}

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
export async function updateRef(
  refPath: string,
  newOid: string,
): Promise<void> {
  const target = refFilePath(refPath);

  // Ensure the containing directory hierarchy exists.
  await fs.promises.mkdir(path.dirname(target), { recursive: true });

  // Write to a temporary file in the same directory so that rename is
  // guaranteed to be on the same filesystem / mount point.
  const tmpFile = path.join(
    path.dirname(target),
    `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  try {
    // Git ref files contain the OID followed by a newline.
    await fs.promises.writeFile(tmpFile, `${newOid}\n`, 'utf8');
    // Atomic rename: readers see either old or new, never a partial state.
    await fs.promises.rename(tmpFile, target);
  } catch (err) {
    // Clean up the tmpfile if something went wrong before the rename.
    await fs.promises.unlink(tmpFile).catch(() => {
      /* ignore cleanup errors */
    });
    throw err;
  }
}

/**
 * Reads the OID stored in a ref.
 *
 * @param refPath - Ref path relative to the git directory.
 * @returns 40-character OID, or null if the ref does not exist.
 */
export async function readRef(refPath: string): Promise<string | null> {
  const target = refFilePath(refPath);
  try {
    const content = await fs.promises.readFile(target, 'utf8');
    return content.trim();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Deletes a ref from the repository.
 * If the ref does not exist, this is a no-op (idempotent).
 *
 * @param refPath - Ref path relative to the git directory.
 */
export async function deleteRef(refPath: string): Promise<void> {
  const target = refFilePath(refPath);
  try {
    await fs.promises.unlink(target);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Already gone — treat as success.
      return;
    }
    throw err;
  }
}

/**
 * Writes a symbolic HEAD file for a git namespace so that `git upload-pack`
 * advertises `symref=HEAD:refs/heads/main` in its capability string.
 *
 * Without this file, `git clone` does not know which branch to check out
 * and emits "warning: remote HEAD refers to nonexistent ref".
 *
 * @param namespace - Namespace name (e.g. 'anonymous-view', 'user-<id>-view').
 */
export async function ensureNamespaceHead(namespace: string): Promise<void> {
  const headPath = path.join(
    getRepoPath(),
    'refs',
    'namespaces',
    namespace,
    'HEAD',
  );
  await fs.promises.mkdir(path.dirname(headPath), { recursive: true });
  // The HEAD file must use the INTERNAL (un-stripped) ref path so that git
  // can resolve it and advertise symref=HEAD:refs/heads/main to clients.
  // Using the external path (refs/heads/main) fails to resolve because the
  // namespace-stripped version has no bare refs/heads/main in the git-dir.
  await fs.promises.writeFile(
    headPath,
    `ref: refs/namespaces/${namespace}/refs/heads/main\n`,
    'utf8',
  );
}
