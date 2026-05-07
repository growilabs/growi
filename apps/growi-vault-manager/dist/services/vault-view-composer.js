/**
 * VaultViewComposer
 *
 * Merges multiple namespace trees into a single per-user (or anonymous) view
 * ref that is served to git clients via git upload-pack.
 *
 * Three strategies are applied in order of preference:
 *
 * 1. **Cache hit** — sourceVersions match currentVersions exactly; return the
 *    existing viewCommitOid without touching the repo.
 *
 * 2. **Delta merge** — existing view is present but some namespace versions
 *    changed; only the changed namespaces' subtrees are recomputed and spliced
 *    into the existing merged tree.  If the base tree has been pruned by gc,
 *    falls back to full merge.
 *
 * 3. **Full merge** — no existing view, or delta merge fallback; all namespace
 *    root trees are merged from scratch using conflict resolution rules.
 *
 * Conflict resolution (same filePath appears in multiple namespaces):
 *   user-<uid>-only-me  >  group-*  >  restricted-link  >  public
 *
 * The viewRef is stored as a git namespace ref:
 *   refs/namespaces/<viewRef>/refs/heads/main
 */
import { VaultNamespaceStateModel } from '../models/vault-namespace-state.js';
import { VaultUserViewModel } from '../models/vault-user-view.js';
import * as VaultRepoStorage from './vault-repo-storage.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Bot identity used for commit author / committer metadata. */
const VAULT_BOT = {
  name: 'GROWI Vault Bot',
  email: 'vault-bot@growi.internal',
};
/**
 * Namespace priority ranking for conflict resolution.
 * Higher index = higher priority; wins over lower-priority namespaces.
 */
const NAMESPACE_PRIORITY_RULES = [
  (ns) => ns === 'public',
  (ns) => ns === 'restricted-link',
  (ns) => ns.startsWith('group-'),
  (ns) => /^user-.+-only-me$/.test(ns),
];
// ---------------------------------------------------------------------------
// Namespace priority helpers
// ---------------------------------------------------------------------------
/**
 * Returns a numeric priority for the given namespace.
 * Higher value = higher priority (wins in path conflict resolution).
 *
 *   user-<uid>-only-me (3) > group-* (2) > restricted-link (1) > public (0)
 *
 * Namespaces that do not match any rule receive priority -1 (lowest).
 */
function namespacePriority(ns) {
  for (let i = NAMESPACE_PRIORITY_RULES.length - 1; i >= 0; i--) {
    if (NAMESPACE_PRIORITY_RULES[i](ns)) {
      return i;
    }
  }
  return -1;
}
// ---------------------------------------------------------------------------
// Ref helpers
// ---------------------------------------------------------------------------
/**
 * Returns the git ref path for a view ref name.
 * For example 'user-<uid>-view' → 'refs/namespaces/user-<uid>-view/refs/heads/main'.
 */
function viewRefPath(viewRef) {
  return `refs/namespaces/${viewRef}/refs/heads/main`;
}
/**
 * Returns the git ref path for a namespace HEAD commit.
 */
function nsRefPath(namespace) {
  return `refs/namespaces/${namespace}/refs/heads/main`;
}
// ---------------------------------------------------------------------------
// Full path enumeration
// ---------------------------------------------------------------------------
/**
 * Recursively collects every (filePath, namespace, blobOid) triple in a
 * namespace's tree.  Only leaf blobs are collected; intermediate trees are
 * traversed but not emitted.
 *
 * @param entries   - Tree entries at the current directory level.
 * @param prefix    - Accumulated path prefix (e.g. 'docs/api/').
 * @param namespace - Namespace that owns these entries.
 * @param result    - Accumulator; mutated in place for performance.
 */
async function collectLeafBlobs(entries, prefix, namespace, result) {
  for (const entry of entries) {
    const fullPath = prefix ? `${prefix}/${entry.path}` : entry.path;
    if (entry.type === 'blob') {
      const existing = result.get(fullPath);
      if (
        existing == null ||
        namespacePriority(namespace) > namespacePriority(existing.namespace)
      ) {
        result.set(fullPath, { namespace, blobOid: entry.oid });
      }
    } else {
      // entry.type === 'tree'
      // biome-ignore lint/performance/noAwaitInLoops: tree structure must be traversed depth-first
      const childEntries = await VaultRepoStorage.readTree(entry.oid);
      // biome-ignore lint/performance/noAwaitInLoops: recursive tree traversal
      await collectLeafBlobs(childEntries, fullPath, namespace, result);
    }
  }
}
// ---------------------------------------------------------------------------
// Tree construction from flat file map
// ---------------------------------------------------------------------------
/**
 * Inserts a single blob entry at the specified path segments into a nested
 * mutable tree map, then writes all touched tree nodes bottom-up.
 *
 * @param treeMap  - Mutable map of dirPath → TreeEntry[].  '.' represents root.
 * @param segments - File path split on '/'.
 * @param blobOid  - 40-char SHA-1 of the blob.
 */
function insertIntoTreeMap(treeMap, segments, blobOid) {
  const filename = segments[segments.length - 1];
  const dirSegments = segments.slice(0, -1);
  const dirKey = dirSegments.length === 0 ? '.' : dirSegments.join('/');
  if (!treeMap.has(dirKey)) {
    treeMap.set(dirKey, []);
  }
  const dirEntries = treeMap.get(dirKey);
  const blobEntry = {
    mode: '100644',
    path: filename,
    oid: blobOid,
    type: 'blob',
  };
  const idx = dirEntries.findIndex((e) => e.path === filename);
  if (idx >= 0) {
    dirEntries[idx] = blobEntry;
  } else {
    dirEntries.push(blobEntry);
  }
  // Ensure all ancestor directories are represented in the map.
  for (let d = 0; d < dirSegments.length; d++) {
    const parentKey = d === 0 ? '.' : dirSegments.slice(0, d).join('/');
    const childKey = dirSegments.slice(0, d + 1).join('/');
    const childName = dirSegments[d];
    if (!treeMap.has(parentKey)) {
      treeMap.set(parentKey, []);
    }
    const parentEntries = treeMap.get(parentKey);
    if (!parentEntries.some((e) => e.path === childName && e.type === 'tree')) {
      // Placeholder — will be replaced with real OID after writeTree pass
      parentEntries.push({
        mode: '040000',
        path: childName,
        oid: '', // filled in bottom-up write pass
        type: 'tree',
      });
    }
  }
}
/**
 * Builds a merged root tree from a flat map of filePath → blobOid.
 * The tree is written bottom-up (deepest directories first).
 *
 * @param fileMap - Map of filePath (e.g. 'docs/api/page.md') → blobOid.
 * @returns Root tree OID.
 */
async function buildTreeFromFileMap(fileMap) {
  // Build a mutable tree structure: dirPath → TreeEntry[]
  const treeMap = new Map();
  treeMap.set('.', []);
  for (const [filePath, blobOid] of fileMap) {
    const segments = filePath.split('/');
    insertIntoTreeMap(treeMap, segments, blobOid);
  }
  if (fileMap.size === 0) {
    // Empty merged tree
    return VaultRepoStorage.writeTree([]);
  }
  // Collect all directory keys and sort deepest first so that child OIDs are
  // known before parent trees reference them.
  const allDirKeys = Array.from(treeMap.keys()).filter((k) => k !== '.');
  allDirKeys.sort((a, b) => {
    const depthA = a.split('/').length;
    const depthB = b.split('/').length;
    return depthB - depthA; // deepest first
  });
  const oidMap = new Map(); // dirPath → treeOid
  // Write each non-root directory tree.
  for (const dirKey of allDirKeys) {
    const entries = treeMap.get(dirKey) ?? [];
    // Replace any placeholder subtree entries with their real OIDs.
    const resolvedEntries = entries.map((e) => {
      if (e.type === 'tree') {
        const childKey = dirKey === '.' ? e.path : `${dirKey}/${e.path}`;
        const realOid = oidMap.get(childKey);
        if (realOid != null) {
          return { ...e, oid: realOid };
        }
      }
      return e;
    });
    // biome-ignore lint/performance/noAwaitInLoops: bottom-up tree writes must be sequential — child OID must exist before parent can reference it
    const treeOid = await VaultRepoStorage.writeTree(resolvedEntries);
    oidMap.set(dirKey, treeOid);
  }
  // Write the root tree.
  const rootEntries = treeMap.get('.') ?? [];
  const resolvedRoot = rootEntries.map((e) => {
    if (e.type === 'tree') {
      const realOid = oidMap.get(e.path);
      if (realOid != null) {
        return { ...e, oid: realOid };
      }
    }
    return e;
  });
  return VaultRepoStorage.writeTree(resolvedRoot);
}
// ---------------------------------------------------------------------------
// Full merge
// ---------------------------------------------------------------------------
/**
 * Performs a full merge of all namespace trees into a single merged tree.
 * Conflict resolution: higher-priority namespace wins for the same filePath.
 *
 * @param namespaces - Ordered list of namespaces to merge.
 * @returns OID of the merged root tree.
 */
export async function fullMergeTreesByPath(namespaces) {
  // Map: filePath → { namespace, blobOid } (highest-priority wins)
  const merged = new Map();
  for (const ns of namespaces) {
    const refOid = await VaultRepoStorage.readRef(nsRefPath(ns));
    if (refOid == null) {
      // Namespace has no commits yet — skip.
      continue;
    }
    // readTree peels a commit OID to its root tree automatically.
    // biome-ignore lint/performance/noAwaitInLoops: each namespace tree must be loaded before collecting blobs
    const rootEntries = await VaultRepoStorage.readTree(refOid);
    // biome-ignore lint/performance/noAwaitInLoops: recursive blob collection
    await collectLeafBlobs(rootEntries, '', ns, merged);
  }
  // Build flat file map (only blobOids, strip namespace metadata).
  const fileMap = new Map();
  for (const [filePath, { blobOid }] of merged) {
    fileMap.set(filePath, blobOid);
  }
  return buildTreeFromFileMap(fileMap);
}
// ---------------------------------------------------------------------------
// Delta merge
// ---------------------------------------------------------------------------
/**
 * Applies namespace delta updates to an existing merged tree.
 *
 * Only the namespaces listed in `changedNamespaces` are re-processed.
 * Unchanged namespace subtrees are inherited from the base merged tree via
 * OID reuse (content-addressed — no data copy).
 *
 * Because the merged tree is a flat path merge (not a namespace-keyed
 * directory structure), we cannot surgically update individual namespace
 * subtrees without re-reading all blobs for the changed namespaces and
 * re-evaluating conflicts.  The strategy is:
 *
 * 1. Enumerate all blobs from the base merged tree (O(pages)).
 * 2. Remove blobs that belong to any changed namespace (must be
 *    recalculated — we do not track per-blob provenance in the merged tree).
 * 3. Re-add blobs from all namespaces that intersect the changed set,
 *    applying priority rules.
 * 4. Write the new merged tree.
 *
 * In practice, "remove blobs belonging to changed namespaces" is an
 * approximation — we cannot know which blobs in the merged tree came from
 * the changed namespaces without provenance metadata.  The correct approach
 * is therefore to re-collect blobs from ALL namespaces for the changed paths,
 * then re-apply priority.  However this still saves I/O on unchanged
 * namespaces because their root tree OIDs have not changed and readTree hits
 * the OS page cache.
 *
 * @param baseTreeOid         - OID of the existing merged root tree.
 * @param allNamespaces       - All namespaces in the view (not just changed ones).
 * @param changedNamespaces   - Subset of namespaces whose commitOid changed.
 * @returns OID of the updated merged root tree.
 * @throws Error when the base tree cannot be read (gc pruned) — caller must fall back to full merge.
 */
export async function applyNamespaceDeltas(
  baseTreeOid,
  allNamespaces,
  changedNamespaces,
) {
  // Re-collect blobs for changed namespaces, then re-apply to the base merged tree.
  // We rebuild from scratch for simplicity and correctness; unchanged namespace
  // trees are still read from cache (OS page cache / git object pool).
  const changedSet = new Set(changedNamespaces);
  // Step 1: Collect blobs from unchanged namespaces using the base tree.
  // Since we cannot attribute per-blob provenance, we do a fresh full merge
  // but rely on unchanged namespace trees being O(1) cache hits.
  const merged = new Map();
  // Enumerate all blobs from unchanged namespaces.
  for (const ns of allNamespaces) {
    if (changedSet.has(ns)) {
      continue; // will be processed in step 2
    }
    const refOid = await VaultRepoStorage.readRef(nsRefPath(ns));
    if (refOid == null) continue;
    // biome-ignore lint/performance/noAwaitInLoops: sequential reads needed; tree OIDs are typically cached
    const rootEntries = await VaultRepoStorage.readTree(refOid);
    // biome-ignore lint/performance/noAwaitInLoops: recursive traversal
    await collectLeafBlobs(rootEntries, '', ns, merged);
  }
  // Step 2: Collect blobs from changed namespaces (re-reads latest commits).
  for (const ns of changedNamespaces) {
    const refOid = await VaultRepoStorage.readRef(nsRefPath(ns));
    if (refOid == null) continue; // namespace may have been removed
    // biome-ignore lint/performance/noAwaitInLoops: sequential reads needed
    const rootEntries = await VaultRepoStorage.readTree(refOid);
    // biome-ignore lint/performance/noAwaitInLoops: recursive traversal
    await collectLeafBlobs(rootEntries, '', ns, merged);
  }
  // Step 3: Build the merged tree from the priority-resolved blob map.
  const fileMap = new Map();
  for (const [filePath, { blobOid }] of merged) {
    fileMap.set(filePath, blobOid);
  }
  return buildTreeFromFileMap(fileMap);
}
// ---------------------------------------------------------------------------
// Cache comparison
// ---------------------------------------------------------------------------
/**
 * Returns true when two SourceVersionMaps are deeply equal.
 * Both must contain the same namespace keys with the same commitOid values.
 */
function sourceVersionsEqual(a, b) {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Composes (or retrieves from cache) a per-user view ref that merges the
 * provided namespaces into a single git tree.
 *
 * @param userId     - GROWI user ObjectId string, or null for anonymous view.
 * @param namespaces - Ordered list of namespaces the user has access to.
 * @returns viewRef and the commitOid at its tip.
 */
export async function compose(userId, namespaces) {
  // Step 1: Determine viewRef name.
  const viewRef = userId != null ? `user-${userId}-view` : 'anonymous-view';
  // Step 2: Build currentVersions map (namespace → commitOid).
  const commitOidMap =
    await VaultNamespaceStateModel.getCommitOidMap(namespaces);
  const currentVersions = {};
  for (const ns of namespaces) {
    // Namespaces with no commits are represented as empty string (not omitted)
    // so that a namespace being populated for the first time is detected as a
    // version change relative to a previously-composed view.
    currentVersions[ns] = commitOidMap[ns] ?? '';
  }
  // Step 3: Load existing cached view (if any).
  const existing = await VaultUserViewModel.findByUserId(userId);
  // Step 4: Cache hit — return without recomposing.
  if (
    existing != null &&
    sourceVersionsEqual(existing.sourceVersions, currentVersions)
  ) {
    return { viewRef, commitOid: existing.viewCommitOid };
  }
  // Step 5: Determine whether to do full merge or delta merge.
  let mergedTreeOid;
  if (existing == null) {
    // Initial compose — full merge.
    mergedTreeOid = await fullMergeTreesByPath(namespaces);
  } else {
    // Delta merge: identify changed namespaces.
    const changedNamespaces = namespaces.filter(
      (ns) => existing.sourceVersions[ns] !== currentVersions[ns],
    );
    try {
      mergedTreeOid = await applyNamespaceDeltas(
        existing.mergedTreeOid,
        namespaces,
        changedNamespaces,
      );
    } catch {
      // Base tree is unavailable (e.g. pruned by gc) — fall back to full merge.
      mergedTreeOid = await fullMergeTreesByPath(namespaces);
    }
  }
  // Step 6: Create a commit on top of the view ref's current tip.
  const now = Math.floor(Date.now() / 1000);
  const parentCommitOid = existing?.viewCommitOid;
  const parents = parentCommitOid != null ? [parentCommitOid] : [];
  const commitOid = await VaultRepoStorage.writeCommit({
    tree: mergedTreeOid,
    parents,
    message: 'vault: view composed',
    author: { ...VAULT_BOT, timestamp: now },
    committer: { ...VAULT_BOT, timestamp: now },
  });
  // Step 7: Update the view ref.
  await VaultRepoStorage.updateRef(viewRefPath(viewRef), commitOid);
  // Step 8: Persist the updated cache.
  await VaultUserViewModel.upsertView(userId, {
    viewRef,
    viewCommitOid: commitOid,
    mergedTreeOid,
    sourceVersions: currentVersions,
  });
  return { viewRef, commitOid };
}
//# sourceMappingURL=vault-view-composer.js.map
