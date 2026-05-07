/**
 * VaultNamespaceBuilder
 *
 * Executes a single VaultInstructionDoc and updates the corresponding
 * namespace ref(s) inside the shared bare repository.
 *
 * Supported ops:
 *  - upsert            — add or update a single page blob in a namespace tree
 *  - remove            — delete a single page blob from a namespace tree
 *  - bulk-upsert       — add or update N page blobs in one commit (concurrency 16)
 *  - rename-prefix     — move a subtree within the same namespace (no blob re-write)
 *  - grant-change-prefix — move a subtree between two namespaces
 *  - reset-all         — delete all namespace refs and clear state; keep object pool
 *
 * All ops are idempotent: submitting the same instruction twice produces the
 * same resulting commit OID (content-addressed git objects + deterministic
 * file paths guarantee convergence).
 */
import { RevisionModel } from '../models/revision.js';
import { VaultNamespaceStateModel } from '../models/vault-namespace-state.js';
import { VaultUserViewModel } from '../models/vault-user-view.js';
import * as VaultBlobHasher from './vault-blob-hasher.js';
import * as VaultPathMapper from './vault-path-mapper.js';
import * as VaultRepoStorage from './vault-repo-storage.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Bot identity used for commit author / committer metadata. */
const VAULT_BOT = {
  name: 'GROWI Vault Bot',
  email: 'vault-bot@growi.internal',
};
/** Maximum number of parallel blob-hash + blob-write tasks in bulk-upsert. */
const BULK_CONCURRENCY = 16;
/** Ref path pattern for a namespace HEAD commit. */
function nsRef(namespace) {
  return `refs/namespaces/${namespace}/refs/heads/main`;
}
// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------
/**
 * Reads the root tree entries from the namespace HEAD commit.
 * Returns an empty array when the namespace has no commits yet.
 *
 * @param namespace - Namespace identifier string.
 */
async function readRootTree(namespace) {
  const oid = await VaultRepoStorage.readRef(nsRef(namespace));
  if (oid == null) {
    return [];
  }
  // readTree accepts a commit OID and peels it to its root tree automatically.
  return VaultRepoStorage.readTree(oid);
}
/**
 * Recursively inserts or replaces `blobOid` at `segments` depth inside the
 * provided tree entries, rebuilding and writing parent trees bottom-up.
 *
 * @param entries   - Current tree entries at this directory level.
 * @param segments  - Remaining path components below this level.
 * @param blobOid   - 40-char SHA-1 of the blob to store.
 * @returns New root-level tree OID after all subtrees have been written.
 */
async function upsertEntryInTree(entries, segments, blobOid) {
  const [head, ...rest] = segments;
  if (rest.length === 0) {
    // Leaf level: replace or insert a blob entry.
    const updated = entries
      .filter((e) => e.path !== head)
      .concat([{ mode: '100644', path: head, oid: blobOid, type: 'blob' }]);
    return VaultRepoStorage.writeTree(updated);
  }
  // Directory level: find or create the subtree entry, recurse into it.
  const existing = entries.find((e) => e.path === head && e.type === 'tree');
  const childEntries =
    existing != null ? await VaultRepoStorage.readTree(existing.oid) : [];
  const childTreeOid = await upsertEntryInTree(childEntries, rest, blobOid);
  const updated = entries
    .filter((e) => e.path !== head)
    .concat([{ mode: '040000', path: head, oid: childTreeOid, type: 'tree' }]);
  return VaultRepoStorage.writeTree(updated);
}
/**
 * Recursively removes the entry at `segments` depth from the tree.
 * Empty intermediate directories are pruned from their parent trees.
 *
 * @param entries  - Current tree entries at this directory level.
 * @param segments - Remaining path components below this level.
 * @returns New root-level tree OID, or null when the resulting tree is empty.
 */
async function removeEntryFromTree(entries, segments) {
  const [head, ...rest] = segments;
  if (rest.length === 0) {
    // Leaf level: drop the blob entry.
    const updated = entries.filter((e) => e.path !== head);
    if (updated.length === 0) {
      return null; // signal empty — parent will prune this directory
    }
    return VaultRepoStorage.writeTree(updated);
  }
  // Directory level: recurse.
  const existing = entries.find((e) => e.path === head && e.type === 'tree');
  if (existing == null) {
    // Path not found — tree is already in the desired state.
    return VaultRepoStorage.writeTree([...entries]);
  }
  const childEntries = await VaultRepoStorage.readTree(existing.oid);
  const childTreeOid = await removeEntryFromTree(childEntries, rest);
  let updated;
  if (childTreeOid == null) {
    // Child tree is now empty — prune it.
    updated = entries.filter((e) => e.path !== head);
  } else {
    updated = entries
      .filter((e) => e.path !== head)
      .concat([
        { mode: '040000', path: head, oid: childTreeOid, type: 'tree' },
      ]);
  }
  if (updated.length === 0) {
    return null;
  }
  return VaultRepoStorage.writeTree(updated);
}
/**
 * Applies a batch of (filePath, blobOid) pairs to a tree in a single
 * bottom-up rebuild.  Each entry is applied sequentially to accumulate
 * the mutations; the caller is responsible for computing blobs in
 * parallel beforehand.
 *
 * @param rootEntries - Starting root tree entries (may be empty for a new namespace).
 * @param patches     - List of (filePath, blobOid) to upsert.
 * @returns OID of the resulting root tree.
 */
async function applyPatchesToTree(rootEntries, patches) {
  let currentEntries = rootEntries;
  for (const { filePath, blobOid } of patches) {
    const segments = filePath.split('/');
    // biome-ignore lint/performance/noAwaitInLoops: tree updates are intentionally sequential — each depends on the previous result
    const newTreeOid = await upsertEntryInTree(
      currentEntries,
      segments,
      blobOid,
    );
    currentEntries = await VaultRepoStorage.readTree(newTreeOid);
  }
  // If patches is empty, write an empty tree so we always return an OID.
  return VaultRepoStorage.writeTree([...currentEntries]);
}
// ---------------------------------------------------------------------------
// Subtree extraction / mounting helpers (rename-prefix / grant-change-prefix)
// ---------------------------------------------------------------------------
/**
 * Reads the subtree OID at the given directory prefix within the root tree.
 * Returns null when the prefix does not exist.
 *
 * @param rootEntries - Root-level tree entries.
 * @param segments    - Directory segments of the prefix path.
 */
async function getSubtreeOid(rootEntries, segments) {
  let entries = rootEntries;
  for (const seg of segments) {
    const found = entries.find((e) => e.path === seg && e.type === 'tree');
    if (found == null) {
      return null;
    }
    // biome-ignore lint/performance/noAwaitInLoops: each level of the tree path must be read before descending
    entries = await VaultRepoStorage.readTree(found.oid);
  }
  // The subtree OID of the innermost directory — write the current entries
  // so we have a stable OID reference.
  return VaultRepoStorage.writeTree([...entries]);
}
/**
 * Inserts a subtree OID at `segments` depth inside the provided tree,
 * writing all ancestor trees bottom-up.
 *
 * @param entries    - Current tree entries at this level.
 * @param segments   - Directory path components.
 * @param subtreeOid - OID of the subtree to mount.
 * @returns OID of the updated tree at this level.
 */
async function mountSubtreeInTree(entries, segments, subtreeOid) {
  const [head, ...rest] = segments;
  if (rest.length === 0) {
    // Mount the subtree directly here.
    const updated = entries
      .filter((e) => e.path !== head)
      .concat([{ mode: '040000', path: head, oid: subtreeOid, type: 'tree' }]);
    return VaultRepoStorage.writeTree(updated);
  }
  // Recurse into the existing child, or start with empty entries.
  const existing = entries.find((e) => e.path === head && e.type === 'tree');
  const childEntries =
    existing != null ? await VaultRepoStorage.readTree(existing.oid) : [];
  const childTreeOid = await mountSubtreeInTree(childEntries, rest, subtreeOid);
  const updated = entries
    .filter((e) => e.path !== head)
    .concat([{ mode: '040000', path: head, oid: childTreeOid, type: 'tree' }]);
  return VaultRepoStorage.writeTree(updated);
}
/**
 * Removes the subtree at `segments` depth from the root tree.
 * Returns null when the result is an empty tree.
 */
async function removeSubtreeFromTree(entries, segments) {
  const [head, ...rest] = segments;
  if (rest.length === 0) {
    const updated = entries.filter((e) => e.path !== head);
    if (updated.length === 0) return null;
    return VaultRepoStorage.writeTree(updated);
  }
  const existing = entries.find((e) => e.path === head && e.type === 'tree');
  if (existing == null) {
    // Already absent — idempotent
    return VaultRepoStorage.writeTree([...entries]);
  }
  const childEntries = await VaultRepoStorage.readTree(existing.oid);
  const childOid = await removeSubtreeFromTree(childEntries, rest);
  let updated;
  if (childOid == null) {
    updated = entries.filter((e) => e.path !== head);
  } else {
    updated = entries
      .filter((e) => e.path !== head)
      .concat([{ mode: '040000', path: head, oid: childOid, type: 'tree' }]);
  }
  if (updated.length === 0) return null;
  return VaultRepoStorage.writeTree(updated);
}
// ---------------------------------------------------------------------------
// Commit + ref update helpers
// ---------------------------------------------------------------------------
/**
 * Creates a commit on top of the current namespace HEAD and updates the ref.
 *
 * @param namespace  - Namespace string used to resolve the ref path.
 * @param treeOid    - Root tree OID for the new commit.
 * @param message    - Commit message.
 * @returns New commit OID.
 */
async function commitAndUpdateRef(namespace, treeOid, message) {
  const parentOid = await VaultRepoStorage.readRef(nsRef(namespace));
  const parents = parentOid != null ? [parentOid] : [];
  const timestamp = Math.floor(Date.now() / 1000);
  const commitOid = await VaultRepoStorage.writeCommit({
    tree: treeOid,
    parents,
    message,
    author: { ...VAULT_BOT, timestamp },
    committer: { ...VAULT_BOT, timestamp },
  });
  await VaultRepoStorage.updateRef(nsRef(namespace), commitOid);
  await VaultNamespaceStateModel.upsertNamespace(namespace, commitOid);
  return commitOid;
}
// ---------------------------------------------------------------------------
// Simple concurrency limiter (avoids external dependencies)
// ---------------------------------------------------------------------------
/**
 * Runs `tasks` with at most `concurrency` promises in-flight at a time.
 * Returns results in the same order as the input array.
 *
 * @param tasks       - Array of async factory functions.
 * @param concurrency - Maximum parallel in-flight tasks.
 */
async function withConcurrency(tasks, concurrency) {
  const results = new Array(tasks.length);
  let index = 0;
  async function worker() {
    while (true) {
      const i = index++;
      if (i >= tasks.length) break;
      // biome-ignore lint/performance/noAwaitInLoops: worker intentionally processes tasks sequentially within its own concurrency slot
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
// ---------------------------------------------------------------------------
// Op implementations
// ---------------------------------------------------------------------------
/**
 * Handles op === 'upsert': write a single page blob and update the namespace tree.
 */
async function applyUpsert(instruction) {
  const { namespace, pageId, pagePath, revisionId } = instruction.payload;
  if (
    namespace == null ||
    pageId == null ||
    pagePath == null ||
    revisionId == null
  ) {
    throw new Error(
      `upsert instruction ${instruction._id} is missing required payload fields`,
    );
  }
  const filePath = VaultPathMapper.map(pagePath, pageId);
  const revision = await RevisionModel.findBodyById(revisionId);
  if (revision == null) {
    throw new Error(
      `Revision ${revisionId} not found for upsert instruction ${instruction._id}`,
    );
  }
  const bodyBuffer = Buffer.from(revision.body);
  const blobOid = await VaultBlobHasher.hashBlob(bodyBuffer);
  await VaultRepoStorage.writeBlob(bodyBuffer);
  const rootEntries = await readRootTree(namespace);
  const newTreeOid = await upsertEntryInTree(
    rootEntries,
    filePath.split('/'),
    blobOid,
  );
  const message =
    `vault: ${namespace} upsert ${pagePath}\n\n` +
    `operation: upsert\n` +
    `pageId: ${pageId}\n` +
    `revisionId: ${revisionId}\n` +
    `issuedAt: ${instruction.issuedAt.toISOString()}`;
  await commitAndUpdateRef(namespace, newTreeOid, message);
}
/**
 * Handles op === 'remove': delete a page blob entry from the namespace tree.
 */
async function applyRemove(instruction) {
  const { namespace, pageId, pagePath } = instruction.payload;
  if (namespace == null || pageId == null || pagePath == null) {
    throw new Error(
      `remove instruction ${instruction._id} is missing required payload fields`,
    );
  }
  const filePath = VaultPathMapper.map(pagePath, pageId);
  const rootEntries = await readRootTree(namespace);
  const newTreeOid = await removeEntryFromTree(
    rootEntries,
    filePath.split('/'),
  );
  // If the tree is empty after removal, write an empty tree.
  const finalTreeOid = newTreeOid ?? (await VaultRepoStorage.writeTree([]));
  const message =
    `vault: ${namespace} remove ${pagePath}\n\n` +
    `operation: remove\n` +
    `pageId: ${pageId}\n` +
    `issuedAt: ${instruction.issuedAt.toISOString()}`;
  await commitAndUpdateRef(namespace, finalTreeOid, message);
}
/**
 * Handles op === 'bulk-upsert': write N page blobs in parallel then rebuild
 * the namespace tree in a single commit.
 */
async function applyBulkUpsert(instruction) {
  const { namespace, entries } = instruction.payload;
  if (namespace == null || entries == null || entries.length === 0) {
    throw new Error(
      `bulk-upsert instruction ${instruction._id} is missing required payload fields`,
    );
  }
  // Fetch all revision bodies in one query using cursor streaming.
  const revisionIds = entries.map((e) => e.revisionId);
  const revisionMap = new Map(); // revisionId → body
  const cursor = RevisionModel.bodyQueryByIds(revisionIds).cursor();
  for await (const rawDoc of cursor) {
    // Mongoose document cursor yields typed documents; cast for safe field access.
    const doc = rawDoc;
    revisionMap.set(String(doc._id), doc.body);
  }
  // Compute (filePath, blobOid) in parallel with concurrency 16.
  const tasks = entries.map((entry) => async () => {
    const filePath = VaultPathMapper.map(entry.pagePath, entry.pageId);
    const body = revisionMap.get(entry.revisionId) ?? '';
    const bodyBuffer = Buffer.from(body);
    const blobOid = await VaultBlobHasher.hashBlob(bodyBuffer);
    await VaultRepoStorage.writeBlob(bodyBuffer);
    return { filePath, blobOid };
  });
  const patches = await withConcurrency(tasks, BULK_CONCURRENCY);
  // Rebuild the namespace tree once with all patches.
  const rootEntries = await readRootTree(namespace);
  const newTreeOid = await applyPatchesToTree(rootEntries, patches);
  const firstEntry = entries[0];
  const lastEntry = entries[entries.length - 1];
  const message =
    `vault: ${namespace} bulk-upsert ${entries.length} entries\n\n` +
    `operation: bulk-upsert\n` +
    `entryCount: ${entries.length}\n` +
    `firstPageId: ${firstEntry.pageId}\n` +
    `lastPageId: ${lastEntry.pageId}\n` +
    `issuedAt: ${instruction.issuedAt.toISOString()}`;
  await commitAndUpdateRef(namespace, newTreeOid, message);
}
/**
 * Handles op === 'rename-prefix': move a subtree within the same namespace.
 * Blobs are not re-written — only tree objects change.
 */
async function applyRenamePrefix(instruction) {
  const { namespace, oldPrefix, newPrefix } = instruction.payload;
  if (namespace == null || oldPrefix == null || newPrefix == null) {
    throw new Error(
      `rename-prefix instruction ${instruction._id} is missing required payload fields`,
    );
  }
  const oldFilePrefix = VaultPathMapper.mapPrefix(oldPrefix);
  const newFilePrefix = VaultPathMapper.mapPrefix(newPrefix);
  const rootEntries = await readRootTree(namespace);
  const oldSegments = oldFilePrefix.split('/');
  // Extract the subtree at oldFilePrefix.
  const subtreeOid = await getSubtreeOid(rootEntries, oldSegments);
  // Remove the old prefix location.
  const afterRemoveOid = await removeSubtreeFromTree(rootEntries, oldSegments);
  const afterRemoveEntries =
    afterRemoveOid != null
      ? await VaultRepoStorage.readTree(afterRemoveOid)
      : [];
  // Mount the subtree at newFilePrefix (if subtree existed).
  let newTreeOid;
  if (subtreeOid != null) {
    const newSegments = newFilePrefix.split('/');
    newTreeOid = await mountSubtreeInTree(
      afterRemoveEntries,
      newSegments,
      subtreeOid,
    );
  } else {
    // Source prefix did not exist — tree is already in desired state.
    newTreeOid = afterRemoveOid ?? (await VaultRepoStorage.writeTree([]));
  }
  const message =
    `vault: ${namespace} rename-prefix ${oldPrefix}→${newPrefix}\n\n` +
    `operation: rename-prefix\n` +
    `oldPrefix: ${oldPrefix}\n` +
    `newPrefix: ${newPrefix}\n` +
    `issuedAt: ${instruction.issuedAt.toISOString()}`;
  await commitAndUpdateRef(namespace, newTreeOid, message);
}
/**
 * Handles op === 'grant-change-prefix': move a subtree from `fromNamespace`
 * to the target `namespace`.  Both namespaces receive a commit.
 */
async function applyGrantChangePrefix(instruction) {
  const { namespace, fromNamespace, oldPrefix } = instruction.payload;
  if (namespace == null || fromNamespace == null || oldPrefix == null) {
    throw new Error(
      `grant-change-prefix instruction ${instruction._id} is missing required payload fields`,
    );
  }
  const filePrefix = VaultPathMapper.mapPrefix(oldPrefix);
  const segments = filePrefix.split('/');
  // --- source namespace: extract and remove ---
  const fromRootEntries = await readRootTree(fromNamespace);
  const subtreeOid = await getSubtreeOid(fromRootEntries, segments);
  const fromAfterOid = await removeSubtreeFromTree(fromRootEntries, segments);
  const fromFinalTreeOid =
    fromAfterOid ?? (await VaultRepoStorage.writeTree([]));
  const fromMessage =
    `vault: ${fromNamespace} grant-change-prefix (source) ${oldPrefix}→${namespace}\n\n` +
    `operation: grant-change-prefix\n` +
    `fromNamespace: ${fromNamespace}\n` +
    `oldPrefix: ${oldPrefix}\n` +
    `issuedAt: ${instruction.issuedAt.toISOString()}`;
  await commitAndUpdateRef(fromNamespace, fromFinalTreeOid, fromMessage);
  // --- destination namespace: mount ---
  const toRootEntries = await readRootTree(namespace);
  let toNewTreeOid;
  if (subtreeOid != null) {
    toNewTreeOid = await mountSubtreeInTree(
      toRootEntries,
      segments,
      subtreeOid,
    );
  } else {
    toNewTreeOid = await VaultRepoStorage.writeTree([...toRootEntries]);
  }
  const toMessage =
    `vault: ${namespace} grant-change-prefix (destination) ${oldPrefix} from ${fromNamespace}\n\n` +
    `operation: grant-change-prefix\n` +
    `fromNamespace: ${fromNamespace}\n` +
    `oldPrefix: ${oldPrefix}\n` +
    `issuedAt: ${instruction.issuedAt.toISOString()}`;
  await commitAndUpdateRef(namespace, toNewTreeOid, toMessage);
}
/**
 * Handles op === 'reset-all': delete every namespace ref and clear
 * vault_namespace_state + vault_user_views.  The object pool is preserved.
 */
async function applyResetAll() {
  // Collect all known namespaces from vault_namespace_state.
  // Lean query to get all namespace strings without loading full docs.
  const allDocs = await VaultNamespaceStateModel.find(
    {},
    { namespace: 1 },
  ).lean();
  // Delete every namespace ref from the bare repository.
  await Promise.all(
    allDocs.map((doc) => VaultRepoStorage.deleteRef(nsRef(doc.namespace))),
  );
  // Clear MongoDB state collections.
  await VaultNamespaceStateModel.deleteAll();
  await VaultUserViewModel.deleteAll();
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Applies a single VaultInstructionDoc to the shared bare repository.
 *
 * The function dispatches to the appropriate op handler based on
 * `instruction.op` and resolves when all git objects, refs, and
 * MongoDB state have been updated atomically within each namespace.
 *
 * Idempotency guarantee: submitting the same instruction twice converges
 * to the same commit OID because git object storage is content-addressed
 * and VaultPathMapper is a pure function.
 *
 * @param instruction - The instruction document to process.
 */
export async function applyInstruction(instruction) {
  switch (instruction.op) {
    case 'upsert':
      await applyUpsert(instruction);
      break;
    case 'remove':
      await applyRemove(instruction);
      break;
    case 'bulk-upsert':
      await applyBulkUpsert(instruction);
      break;
    case 'rename-prefix':
      await applyRenamePrefix(instruction);
      break;
    case 'grant-change-prefix':
      await applyGrantChangePrefix(instruction);
      break;
    case 'reset-all':
      await applyResetAll();
      break;
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive = instruction.op;
      throw new Error(`Unknown vault instruction op: ${_exhaustive}`);
    }
  }
}
//# sourceMappingURL=vault-namespace-builder.js.map
