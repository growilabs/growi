/**
 * reconcile-target-resolver.ts
 *
 * Pure function that maps a reconcile target specification
 * ({ targetType, targetPath }) to a MongoDB FilterQuery for the pages
 * collection.
 *
 * Requirements: 1.4, 1.5
 */

import type { ReconcileTargetType } from '~/features/growi-vault/server/models/vault-reconcile-log';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Minimal subset of a Mongoose FilterQuery for the pages collection.
 * Using Record<string, unknown> keeps this module free of a full mongoose
 * import and makes it straightforward to unit-test as a pure function.
 */
export type PageQueryFilter = Record<string, unknown>;

export type TargetResolveResult =
  | { readonly ok: true; readonly query: PageQueryFilter }
  | { readonly ok: false; readonly reason: 'invalid-target' };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Escapes all regex metacharacters in a string so it can be safely embedded
 * inside a MongoDB $regex value without causing regex injection.
 *
 * Escaped characters: . * + ? ^ $ { } [ ] ( ) | \
 */
function escapeRegExp(s: string): string {
  // The backslash must come first in the character class so it is escaped
  // before the other characters are processed.
  return s.replace(/[.*+?^${}()[\]|\\]/g, '\\$&');
}

/**
 * Validates that the given path is a well-formed GROWI page path.
 *
 * Rules:
 * - Must be a non-empty string
 * - Must start with '/'
 * - Must not contain consecutive slashes (//)
 * - Must not contain newline characters (\n or \r)
 */
function isValidPath(path: string): boolean {
  if (path.length === 0) return false;
  if (!path.startsWith('/')) return false;
  if (/\r|\n/.test(path)) return false;
  if (path.includes('//')) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves a reconcile target specification to a MongoDB FilterQuery.
 *
 * - targetType 'page'     → `{ path: targetPath }` (exact match)
 * - targetType 'sub-tree' → `{ $or: [{ path: targetPath }, { path: { $regex: ... } }] }`
 *   where the $regex matches all descendant paths ('^' + escaped + '/')
 *
 * Returns `{ ok: false, reason: 'invalid-target' }` when targetPath fails
 * validation (empty / no leading slash / consecutive slashes / newlines).
 */
export function resolveTarget(
  targetType: ReconcileTargetType,
  targetPath: string,
): TargetResolveResult {
  if (!isValidPath(targetPath)) {
    return { ok: false, reason: 'invalid-target' };
  }

  if (targetType === 'page') {
    return {
      ok: true,
      query: { path: targetPath },
    };
  }

  // sub-tree: self + all descendants
  const escapedPath = escapeRegExp(targetPath);
  return {
    ok: true,
    query: {
      $or: [{ path: targetPath }, { path: { $regex: `^${escapedPath}/` } }],
    },
  };
}
