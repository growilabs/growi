import type { Collection, Document, Filter } from 'mongodb';

import loggerFactory from '~/utils/logger';

import {
  activeUserFilter,
  bothFilter,
  legacyOnlyFilter,
  nonActiveUserFilter,
  scopeFilter,
} from '../models/user/password-hash-format-filters';

const logger = loggerFactory('growi:service:password-hash-cleanup');

export interface PasswordHashCleanupResult {
  /** true when the run aborted without touching the DB (blocking legacyOnly users remain). */
  aborted: boolean;
  /**
   * number of ACTIVE not-yet-migrated users (password only, no passwordHash).
   * These block the cleanup: an admin can reasonably expect them back, so lazy
   * migration will clear the count on its own.
   */
  legacyOnly: number;
  /**
   * number of NON-ACTIVE not-yet-migrated users (invited / registered /
   * suspended / deleted). They CAN still migrate lazily (status is only checked
   * after authentication succeeds), but nobody can compel them to log in before
   * the cleanup window — so they are reported for visibility and must NOT block
   * the cleanup.
   */
  legacyOnlyNonActive: number;
  /** number of documents from which the legacy `password` field was $unset. */
  unset: number;
}

/**
 * Remove the legacy SHA-256 `password` field from fully-migrated users.
 *
 * WHY this is never auto-run: aborting is a hard requirement (Req 3.4), and a
 * `throw`/exit during migrate-mongo's boot-time auto-run would break the
 * deployment. An administrator triggers it deliberately instead.
 *
 * TWO ENTRY POINTS call this, which is why the operation lives here rather than
 * inside either one:
 *   - `scripts/password-hash-cleanup.ts` — CLI, for an operator with container
 *     shell access (`pnpm run password-hash:cleanup`)
 *   - the admin API (`routes/apiv3/security-settings/password-hash.ts`) — for a
 *     GROWI administrator, who in managed hosting has no shell at all
 *
 * This function is the pure core: it takes the `users` collection as input and
 * returns a structured result. It never calls process.exit, never reads env, and
 * never opens its own connection, so each entry point supplies those concerns.
 *
 * Steps:
 *  1. Count `legacyOnly` users (`password` set, `passwordHash` unset), split by
 *     whether they are ACTIVE.
 *  2. If any ACTIVE one exists, ABORT without writing (Req 3.4) — cleaning up now
 *     would leave those users unable to authenticate after a downgrade.
 *  3. Otherwise `$unset` the legacy `password` field from every `both` user
 *     (both fields present), keeping the scrypt `passwordHash` (Req 3.3).
 *
 * NOTE 1: only ACTIVE legacyOnly users block the abort. A non-active user is NOT
 * excluded because they cannot log in — they can: the login path applies no status
 * filter (`findUserByUsernameOrEmail` + `verifyLocalCredentials` both ignore
 * status; status is only consulted AFTER authentication succeeds, to pick the
 * redirect), so an invited / registered / suspended user who authenticates IS
 * lazily migrated. They are excluded because an admin cannot *wait for or compel*
 * them to do so: an invitee may never accept, a suspended account may never come
 * back. Letting them block would make Phase 3 (cleanup) unreachable indefinitely
 * on the whim of accounts nobody expects to return. The non-blocking count is
 * still reported so an admin sees the whole picture.
 *
 * NOTE 2: the `$unset` itself is NOT status-scoped. Removing a suspended user's
 * retired legacy hash is correct and desirable; only the abort decision cares
 * about who can still log in.
 *
 * NOTE 3: classification uses the shared password-hash-format filters, which treat
 * an empty string / `null` credential as ABSENT (not just `{ $exists: false }`).
 * `statusDelete()` scrubbed deleted users to `password: ''` on older builds, so a
 * lingering legacy `password: ''` must read as "no password" — otherwise those
 * deleted users are counted as `legacyOnly` and this cleanup would abort forever.
 */
export async function runPasswordHashCleanup(
  usersCollection: Collection,
  baseFilter: Filter<Document> = {},
): Promise<PasswordHashCleanupResult> {
  // `baseFilter` defaults to `{}` (whole collection) so `main()` and production
  // behavior are unchanged; a caller (integ test) may pass a scope to narrow the
  // count/write to a marker-seeded subset of the shared `users` collection.
  const legacyOnly = await usersCollection.countDocuments(
    scopeFilter(baseFilter, legacyOnlyFilter, activeUserFilter),
  );
  const legacyOnlyNonActive = await usersCollection.countDocuments(
    scopeFilter(baseFilter, legacyOnlyFilter, nonActiveUserFilter),
  );

  if (legacyOnly > 0) {
    // Abort WITHOUT modifying the DB (Req 3.4).
    logger.error(
      `Aborting password-hash cleanup: ${legacyOnly} active not-yet-migrated user(s) still have a legacy password but no passwordHash (plus ${legacyOnlyNonActive} non-active one(s), which do not block). No documents were modified. Let every active user log in (lazy migration) until the blocking count is 0 before running cleanup.`,
    );
    return { aborted: true, legacyOnly, legacyOnlyNonActive, unset: 0 };
  }

  if (legacyOnlyNonActive > 0) {
    logger.warn(
      `${legacyOnlyNonActive} non-active user(s) (invited/registered/suspended/deleted) still hold a legacy password and no passwordHash. They would still be migrated lazily if they logged in, but they cannot be compelled to do so before this cleanup, so they do NOT block it; their legacy password field is left as is. If any of them is expected back, have them log in (or reset their password) before running cleanup.`,
    );
  }

  // NOT status-scoped on purpose: a suspended/invited user's retired legacy hash
  // should be cleaned up too (see NOTE 2 above).
  const updateResult = await usersCollection.updateMany(
    scopeFilter(baseFilter, bothFilter),
    {
      $unset: { password: '' },
    },
  );

  logger.info(
    `Password-hash cleanup complete: removed the legacy password field from ${updateResult.modifiedCount} fully-migrated user(s).`,
  );

  return {
    aborted: false,
    legacyOnly: 0,
    legacyOnlyNonActive,
    unset: updateResult.modifiedCount,
  };
}
