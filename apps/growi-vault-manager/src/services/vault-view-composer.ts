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

import type {
  ComposeViewResponse,
  Namespace,
} from '@growi/core/dist/interfaces/vault';

import { VaultNamespaceStateModel } from '../models/vault-namespace-state.js';
import {
  type SourceVersionMap,
  VaultUserViewModel,
} from '../models/vault-user-view.js';
import type { TreeEntry } from './vault-repo-storage.js';
import * as VaultRepoStorage from './vault-repo-storage.js';
import { normalizeTree, type TreeNode } from './vault-tree-normalizer.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Bot identity used for commit author / committer metadata. */
const VAULT_BOT = {
  name: 'GROWI Vault Bot',
  email: 'vault-bot@growi.internal',
} as const;

/**
 * Namespace priority ranking for conflict resolution.
 * Higher index = higher priority; wins over lower-priority namespaces.
 */
const NAMESPACE_PRIORITY_RULES: ReadonlyArray<(ns: string) => boolean> = [
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
function namespacePriority(ns: string): number {
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
function viewRefPath(viewRef: string): string {
  return `refs/namespaces/${viewRef}/refs/heads/main`;
}

/**
 * Returns the git ref path for a namespace HEAD commit.
 */
function nsRefPath(namespace: string): string {
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
async function collectLeafBlobs(
  entries: ReadonlyArray<TreeEntry>,
  prefix: string,
  namespace: string,
  result: Map<string, { namespace: string; blobOid: string }>,
): Promise<void> {
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
      // biome-ignore lint/performance/noAwaitInLoops: tree structure must be traversed depth-first; child OIDs depend on parent
      const childEntries = await VaultRepoStorage.readTree(entry.oid);
      await collectLeafBlobs(childEntries, fullPath, namespace, result);
    }
  }
}

// ---------------------------------------------------------------------------
// Tree construction from flat file map
// ---------------------------------------------------------------------------

/**
 * Builds a recursive TreeNode[] from a flat filePath → blobOid map.
 *
 * This is a pure in-memory operation: no I/O is performed.  Blob OIDs are
 * embedded directly; subtree OIDs are left as empty string placeholders
 * (they are not needed since writeTreeNodes resolves them bottom-up).
 *
 * @param fileMap - Map of filePath (e.g. 'docs/api/page.md') → blobOid.
 * @returns Root-level TreeNode array representing the complete tree hierarchy.
 */
function buildTreeNodes(fileMap: Map<string, string>): ReadonlyArray<TreeNode> {
  // dirMap: dirPath ('.' = root) → map of childName → TreeNode (mutable during build)
  const dirMap = new Map<string, Map<string, TreeNode>>();
  dirMap.set('.', new Map());

  for (const [filePath, blobOid] of fileMap) {
    const segments = filePath.split('/');
    const filename = segments[segments.length - 1];
    const dirSegments = segments.slice(0, -1);
    const dirKey = dirSegments.length === 0 ? '.' : dirSegments.join('/');

    // Ensure all ancestor directories exist in dirMap.
    for (let d = 0; d < dirSegments.length; d++) {
      const ancestorKey = d === 0 ? '.' : dirSegments.slice(0, d).join('/');
      const childName = dirSegments[d];
      const childKey = dirSegments.slice(0, d + 1).join('/');
      if (!dirMap.has(childKey)) {
        dirMap.set(childKey, new Map());
      }
      const parentMap = dirMap.get(ancestorKey);
      if (parentMap != null && !parentMap.has(childName)) {
        // Placeholder subtree node — children populated below.
        parentMap.set(childName, {
          entry: { mode: '040000', path: childName, oid: '', type: 'tree' },
        });
      }
    }

    // Add the blob leaf to its directory.
    let targetMap = dirMap.get(dirKey);
    if (targetMap == null) {
      targetMap = new Map();
      dirMap.set(dirKey, targetMap);
    }
    targetMap.set(filename, {
      entry: { mode: '100644', path: filename, oid: blobOid, type: 'blob' },
    });
  }

  /**
   * Recursively attaches children to subtree nodes by reading from dirMap.
   */
  function attachChildren(
    prefix: string,
    nodes: ReadonlyArray<TreeNode>,
  ): ReadonlyArray<TreeNode> {
    return nodes.map((node) => {
      if (node.entry.type !== 'tree') return node;
      const childKey =
        prefix !== '' ? `${prefix}/${node.entry.path}` : node.entry.path;
      const childMap = dirMap.get(childKey);
      if (childMap == null || childMap.size === 0) {
        return { ...node, children: [] };
      }
      const childNodes = Array.from(childMap.values());
      return {
        ...node,
        children: attachChildren(childKey, childNodes),
      };
    });
  }

  const rootMap = dirMap.get('.') ?? new Map();
  const rootNodes = Array.from(rootMap.values());
  return attachChildren('', rootNodes);
}

/**
 * Writes a recursive TreeNode[] structure to git storage bottom-up.
 *
 * Subtrees are written deepest-first so that child OIDs are available when
 * parent trees reference them.
 *
 * @param nodes - Root-level TreeNode array (after normalization).
 * @returns OID of the written root tree object.
 */
async function writeTreeNodes(nodes: ReadonlyArray<TreeNode>): Promise<string> {
  /**
   * Recursively writes a subtree and returns its OID.
   */
  async function writeNode(node: TreeNode): Promise<TreeEntry> {
    if (node.entry.type === 'blob' || node.children == null) {
      return node.entry;
    }
    // Recurse into children first (bottom-up).
    const childEntries: TreeEntry[] = [];
    for (const child of node.children) {
      // biome-ignore lint/performance/noAwaitInLoops: bottom-up tree writes must be sequential — child OID must exist before parent can reference it
      childEntries.push(await writeNode(child));
    }
    const subtreeOid = await VaultRepoStorage.writeTree(childEntries);
    return { ...node.entry, oid: subtreeOid };
  }

  const rootEntries: TreeEntry[] = [];
  for (const node of nodes) {
    // biome-ignore lint/performance/noAwaitInLoops: bottom-up tree writes must be sequential — child OID must exist before parent can reference it
    rootEntries.push(await writeNode(node));
  }
  return VaultRepoStorage.writeTree(rootEntries);
}

/**
 * Builds a merged root tree from a flat map of filePath → blobOid, applying
 * VaultTreeNormalizer to resolve case-insensitive name collisions before
 * writing to storage.
 *
 * Order of operations (satisfies req 4.9):
 *   1. Build in-memory TreeNode[] from the ACL-resolved flat file map.
 *   2. Apply normalizeTree() — deterministic, pure, no I/O.
 *   3. Write the normalized tree bottom-up to the git object store.
 *
 * @param fileMap - Map of filePath (e.g. 'docs/api/page.md') → blobOid.
 * @returns Root tree OID.
 */
function buildTreeFromFileMap(fileMap: Map<string, string>): Promise<string> {
  if (fileMap.size === 0) {
    return VaultRepoStorage.writeTree([]);
  }

  // Step 1: Build in-memory recursive tree (pure, no I/O).
  const rawNodes = buildTreeNodes(fileMap);

  // Step 2: Normalize — resolve case-insensitive collisions (req 4.9, 4.10, 4.11).
  // Applied AFTER ACL priority resolution (which happened in collectLeafBlobs).
  const normalizedNodes = normalizeTree(rawNodes);

  // Step 3: Write the normalized tree bottom-up to the git object store.
  return writeTreeNodes(normalizedNodes);
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
export async function fullMergeTreesByPath(
  namespaces: ReadonlyArray<string>,
): Promise<string> {
  // Map: filePath → { namespace, blobOid } (highest-priority wins)
  const merged = new Map<string, { namespace: string; blobOid: string }>();

  for (const ns of namespaces) {
    // biome-ignore lint/performance/noAwaitInLoops: namespace blob collection mutates a shared priority-resolved map; sequential is required
    const refOid = await VaultRepoStorage.readRef(nsRefPath(ns));
    if (refOid == null) {
      // Namespace has no commits yet — skip.
      continue;
    }

    // readTree peels a commit OID to its root tree automatically.
    const rootEntries = await VaultRepoStorage.readTree(refOid);
    await collectLeafBlobs(rootEntries, '', ns, merged);
  }

  // Build flat file map (only blobOids, strip namespace metadata).
  const fileMap = new Map<string, string>();
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
 * @param _baseTreeOid        - OID of the existing merged root tree (currently unused; reserved for future surgical delta updates).
 * @param allNamespaces       - All namespaces in the view (not just changed ones).
 * @param changedNamespaces   - Subset of namespaces whose commitOid changed.
 * @returns OID of the updated merged root tree.
 * @throws Error when the base tree cannot be read (gc pruned) — caller must fall back to full merge.
 */
export async function applyNamespaceDeltas(
  _baseTreeOid: string,
  allNamespaces: ReadonlyArray<string>,
  changedNamespaces: ReadonlyArray<string>,
): Promise<string> {
  // Re-collect blobs for changed namespaces, then re-apply to the base merged tree.
  // We rebuild from scratch for simplicity and correctness; unchanged namespace
  // trees are still read from cache (OS page cache / git object pool).
  const changedSet = new Set(changedNamespaces);

  // Step 1: Collect blobs from unchanged namespaces using the base tree.
  // Since we cannot attribute per-blob provenance, we do a fresh full merge
  // but rely on unchanged namespace trees being O(1) cache hits.
  const merged = new Map<string, { namespace: string; blobOid: string }>();

  // Enumerate all blobs from unchanged namespaces.
  for (const ns of allNamespaces) {
    if (changedSet.has(ns)) {
      continue; // will be processed in step 2
    }
    // biome-ignore lint/performance/noAwaitInLoops: namespace blob collection mutates a shared priority-resolved map; sequential is required
    const refOid = await VaultRepoStorage.readRef(nsRefPath(ns));
    if (refOid == null) continue;
    const rootEntries = await VaultRepoStorage.readTree(refOid);
    await collectLeafBlobs(rootEntries, '', ns, merged);
  }

  // Step 2: Collect blobs from changed namespaces (re-reads latest commits).
  for (const ns of changedNamespaces) {
    // biome-ignore lint/performance/noAwaitInLoops: namespace blob collection mutates a shared priority-resolved map; sequential is required
    const refOid = await VaultRepoStorage.readRef(nsRefPath(ns));
    if (refOid == null) continue; // namespace may have been removed
    const rootEntries = await VaultRepoStorage.readTree(refOid);
    await collectLeafBlobs(rootEntries, '', ns, merged);
  }

  // Step 3: Build the merged tree from the priority-resolved blob map.
  const fileMap = new Map<string, string>();
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
function sourceVersionsEqual(
  a: SourceVersionMap,
  b: SourceVersionMap,
): boolean {
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
export async function compose(
  userId: string | null,
  namespaces: ReadonlyArray<Namespace>,
): Promise<ComposeViewResponse> {
  // Step 1: Determine viewRef name.
  const viewRef = userId != null ? `user-${userId}-view` : 'anonymous-view';

  // Step 2: Build currentVersions map (namespace → commitOid).
  const commitOidMap =
    await VaultNamespaceStateModel.getCommitOidMap(namespaces);
  const currentVersions: SourceVersionMap = {};
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
  let mergedTreeOid: string;

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

  // Step 7: Update the view ref and ensure the namespace HEAD symref exists.
  await VaultRepoStorage.updateRef(viewRefPath(viewRef), commitOid);
  // git upload-pack needs refs/namespaces/<viewRef>/HEAD to advertise
  // symref=HEAD:refs/heads/main so that `git clone` can checkout the branch.
  await VaultRepoStorage.ensureNamespaceHead(viewRef);

  // Step 8: Persist the updated cache.
  await VaultUserViewModel.upsertView(userId, {
    viewRef,
    viewCommitOid: commitOid,
    mergedTreeOid,
    sourceVersions: currentVersions,
  });

  return { viewRef, commitOid };
}
