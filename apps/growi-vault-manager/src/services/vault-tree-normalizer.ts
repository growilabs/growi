/**
 * VaultTreeNormalizer
 *
 * Pure function that resolves case-insensitive name collisions in a merged
 * tree. Operates entirely on the in-memory tree structure — no I/O, no
 * persistent state.
 *
 * Requirements satisfied:
 *   4.9  — normalization is derived deterministically from the merged tree
 *           structure alone; no reverse-index collection required.
 *   4.10 — entries whose lowercase names collide within the same directory
 *           receive a __<hash8> suffix where hash8 = sha1(fullPath)[0..7].
 *   4.11 — when a collision group shrinks to 1 member, no suffix is added
 *           (reactive: computed fresh from current tree on every call).
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
 * Returns the 8-character SHA-1 prefix of filePath, used as the collision
 * disambiguation suffix.
 *
 * @param filePath - Full path from tree root **before** any suffix is applied.
 */
function computeHash8(filePath: string): string {
  return createHash('sha1').update(filePath).digest('hex').slice(0, 8);
}

/**
 * Inserts `__<hash8>` into an entry name:
 * - For names with an extension (e.g. `MyPage.md`): inserts before the last
 *   `.` → `MyPage__<hash8>.md`.
 * - For names without an extension (e.g. a directory or extensionless blob):
 *   appends the suffix at the end → `MyPage__<hash8>`.
 *
 * @param name   - Original entry name (path component only, no slashes).
 * @param hash8  - 8-character SHA-1 prefix.
 */
function insertSuffix(name: string, hash8: string): string {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex > 0) {
    // Has an extension — insert before it.
    return `${name.slice(0, dotIndex)}__${hash8}${name.slice(dotIndex)}`;
  }
  // No extension (directory name or extensionless blob) — append.
  return `${name}__${hash8}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalizes a tree level by resolving case-insensitive name collisions.
 *
 * For each directory level:
 *   - Group entries by `entry.path.toLowerCase()`.
 *   - If a group contains 2 or more members, apply `__<hash8>` suffix to
 *     each member's name (where hash8 = sha1(fullPathBeforeSuffix)[0..7]).
 *   - If a group contains exactly 1 member, no suffix is applied (covers the
 *     reactive removal case described in requirement 4.11).
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

    if (group.length >= 2) {
      // Collision: apply suffix to this entry.
      const fullPath =
        parentPath !== ''
          ? `${parentPath}/${node.entry.path}`
          : node.entry.path;
      const h8 = computeHash8(fullPath);
      const newName = insertSuffix(node.entry.path, h8);

      // Recurse into subtree children using the original (pre-suffix) path.
      const newChildren =
        node.children != null
          ? normalizeTree(node.children, fullPath)
          : undefined;

      result.push({
        entry: { ...node.entry, path: newName },
        ...(newChildren != null ? { children: newChildren } : {}),
      });
    } else {
      // No collision: entry name is used as-is.
      const fullPath =
        parentPath !== ''
          ? `${parentPath}/${node.entry.path}`
          : node.entry.path;

      // Recurse into subtree children.
      const newChildren =
        node.children != null
          ? normalizeTree(node.children, fullPath)
          : undefined;

      result.push({
        entry: node.entry,
        ...(newChildren != null ? { children: newChildren } : {}),
      });
    }
  }

  return result;
}
