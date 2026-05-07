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
import type { Namespace } from '@growi/core/dist/interfaces/vault';
import type { ComposeViewResponse } from '@growi/core/dist/interfaces/vault';
/**
 * Performs a full merge of all namespace trees into a single merged tree.
 * Conflict resolution: higher-priority namespace wins for the same filePath.
 *
 * @param namespaces - Ordered list of namespaces to merge.
 * @returns OID of the merged root tree.
 */
export declare function fullMergeTreesByPath(
  namespaces: ReadonlyArray<string>,
): Promise<string>;
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
export declare function applyNamespaceDeltas(
  baseTreeOid: string,
  allNamespaces: ReadonlyArray<string>,
  changedNamespaces: ReadonlyArray<string>,
): Promise<string>;
/**
 * Composes (or retrieves from cache) a per-user view ref that merges the
 * provided namespaces into a single git tree.
 *
 * @param userId     - GROWI user ObjectId string, or null for anonymous view.
 * @param namespaces - Ordered list of namespaces the user has access to.
 * @returns viewRef and the commitOid at its tip.
 */
export declare function compose(
  userId: string | null,
  namespaces: ReadonlyArray<Namespace>,
): Promise<ComposeViewResponse>;
