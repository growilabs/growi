/**
 * VaultTreeNormalizer
 *
 * Pure function that turns a merged tree into names a client can actually
 * check out: it resolves case-insensitive name collisions and keeps every name
 * within the filesystem's per-component byte limit. Operates entirely on the
 * in-memory tree structure — no I/O, no persistent state.
 *
 * Requirements satisfied:
 *   4.9  — normalization is derived deterministically from the merged tree
 *           structure alone; no reverse-index collection required.
 *   4.10 — entries whose lowercase names collide within the same directory
 *           receive a __<hash8> suffix where hash8 = sha1(fullPath)[0..7].
 *   4.11 — when a collision group shrinks to 1 member, no suffix is added
 *           (reactive: computed fresh from current tree on every call).
 *   4.12 — names that would exceed MAX_ENTRY_NAME_BYTES are shortened and
 *           given the same __<hash8> suffix, so one over-long page name can no
 *           longer abort the whole checkout.
 */

import { createHash } from 'node:crypto';

import type { TreeEntry } from './vault-repo-storage.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A recursive tree node: an entry together with its optional subtree children.
 * Only entries of type 'tree' may have children.
 */
export interface TreeNode {
  readonly entry: TreeEntry;
  readonly children?: ReadonlyArray<TreeNode>; // present iff entry.type === 'tree'
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Maximum number of UTF-8 bytes allowed in a single tree entry name.
 *
 * ext4 and APFS reject a path component longer than 255 bytes with
 * ENAMETOOLONG, and `git checkout` / `git reset --hard` abort the *entire*
 * operation on the first rejected file — so one over-long page name would
 * otherwise leave the whole clone unusable (issue #11596). A Japanese page
 * title reaches this limit at 85 characters.
 *
 * The budget is the raw filesystem limit rather than a smaller, safer-looking
 * number on purpose: names that already fit are returned byte-for-byte
 * unchanged, so the only entries this renames are the ones no client could
 * check out in the first place. Lowering it later would rename names that work
 * today, which existing clones would see as a churn of renames.
 */
const MAX_ENTRY_NAME_BYTES = 255;

/**
 * Returns the 8-character SHA-1 prefix of filePath, used as the
 * disambiguation suffix for both collisions and shortened names.
 *
 * @param filePath - Full path from tree root **before** any suffix is applied.
 */
function computeHash8(filePath: string): string {
  return createHash('sha1').update(filePath).digest('hex').slice(0, 8);
}

/**
 * Splits an entry name into its stem and extension. The extension is the last
 * `.` and everything after it, and only when that `.` is not the first
 * character (a leading dot marks a hidden file, not an extension).
 */
function splitExtension(name: string): { stem: string; ext: string } {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex > 0) {
    return { stem: name.slice(0, dotIndex), ext: name.slice(dotIndex) };
  }
  return { stem: name, ext: '' };
}

/**
 * Truncates `text` to at most `maxBytes` UTF-8 bytes, cutting only on code
 * point boundaries. Cutting inside a code point would leave a lone surrogate,
 * which encodes to U+FFFD — the client would then see a name that no longer
 * matches the beginning of its page title.
 */
function truncateToBytes(text: string, maxBytes: number): string {
  let result = '';
  let usedBytes = 0;
  for (const codePoint of text) {
    const cost = Buffer.byteLength(codePoint, 'utf8');
    if (usedBytes + cost > maxBytes) {
      break;
    }
    result += codePoint;
    usedBytes += cost;
  }
  return result;
}

/** True when the name is too long for the filesystem to accept as-is. */
function exceedsByteBudget(name: string): boolean {
  return Buffer.byteLength(name, 'utf8') > MAX_ENTRY_NAME_BYTES;
}

/**
 * Inserts `__<hash8>` into an entry name, shortening the stem when the result
 * would not fit in MAX_ENTRY_NAME_BYTES:
 * - For names with an extension (e.g. `MyPage.md`): inserts before the last
 *   `.` → `MyPage__<hash8>.md`.
 * - For names without an extension (e.g. a directory or extensionless blob):
 *   appends the suffix at the end → `MyPage__<hash8>`.
 *
 * The budget is applied to the *final* name, suffix included, because the
 * 10-byte suffix can by itself push a name that fits over the limit.
 *
 * @param name   - Original entry name (path component only, no slashes).
 * @param hash8  - 8-character SHA-1 prefix.
 */
function insertSuffix(name: string, hash8: string): string {
  const suffix = `__${hash8}`;
  const { stem, ext } = splitExtension(name);
  const stemBudget =
    MAX_ENTRY_NAME_BYTES -
    Buffer.byteLength(suffix, 'utf8') -
    Buffer.byteLength(ext, 'utf8');

  // A page title that contains a dot can produce an "extension" long enough to
  // consume the whole budget. Keep the entry addressable by shortening the name
  // as a whole rather than preserving that extension.
  if (stemBudget <= 0) {
    const nameBudget = MAX_ENTRY_NAME_BYTES - Buffer.byteLength(suffix, 'utf8');
    return `${truncateToBytes(name, nameBudget)}${suffix}`;
  }

  // truncateToBytes() returns the stem unchanged when it already fits.
  return `${truncateToBytes(stem, stemBudget)}${suffix}${ext}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalizes a tree level by resolving case-insensitive name collisions and
 * keeping every name within MAX_ENTRY_NAME_BYTES.
 *
 * For each directory level:
 *   - Group entries by `entry.path.toLowerCase()`.
 *   - If a group contains 2 or more members, apply `__<hash8>` suffix to
 *     each member's name (where hash8 = sha1(fullPathBeforeSuffix)[0..7]).
 *   - If a group contains exactly 1 member, no suffix is applied (covers the
 *     reactive removal case described in requirement 4.11).
 *   - Independently of collisions, a name whose UTF-8 length exceeds
 *     MAX_ENTRY_NAME_BYTES is shortened and given the same `__<hash8>` suffix
 *     (requirement 4.12). Two over-long names that share their leading
 *     characters stay distinct because their full paths — and therefore their
 *     hashes — differ.
 *
 * The function recurses into subtrees, propagating the parent's original path
 * (before any suffix) as the prefix for child full-path computation.
 *
 * This is a **pure function**: no side effects, no I/O, no persistent state.
 *
 * @param nodes      - Entries at the current directory level.
 * @param parentPath - Full path to the current directory from the tree root
 *                     (empty string for the root level). Used to compute the
 *                     pre-suffix full path for each entry.
 * @returns A new array of TreeNodes with collision-resolved names.
 */
export function normalizeTree(
  nodes: ReadonlyArray<TreeNode>,
  parentPath = '',
): ReadonlyArray<TreeNode> {
  // Step 1: Group by lowercase name to detect collisions.
  const groups = new Map<string, ReadonlyArray<TreeNode>>();
  for (const node of nodes) {
    const key = node.entry.path.toLowerCase();
    const existing = groups.get(key);
    groups.set(key, existing != null ? [...existing, node] : [node]);
  }

  // Step 2: Resolve each group.
  const result: TreeNode[] = [];

  for (const node of nodes) {
    const key = node.entry.path.toLowerCase();
    // The key was just inserted from this same node, so get() always returns a value.
    const group = groups.get(key) ?? [];

    const fullPath =
      parentPath !== '' ? `${parentPath}/${node.entry.path}` : node.entry.path;

    // Recurse into subtree children using the original (pre-suffix) path, so
    // child names stay stable regardless of what happens to the parent's name.
    const newChildren =
      node.children != null
        ? normalizeTree(node.children, fullPath)
        : undefined;

    // A suffix is applied either to break a case-insensitive collision (4.10)
    // or to make an over-long name checkoutable (4.12). Otherwise the entry
    // name is used as-is.
    const needsSuffix = group.length >= 2 || exceedsByteBudget(node.entry.path);
    const newName = needsSuffix
      ? insertSuffix(node.entry.path, computeHash8(fullPath))
      : node.entry.path;

    result.push({
      entry: { ...node.entry, path: newName },
      ...(newChildren != null ? { children: newChildren } : {}),
    });
  }

  return result;
}
