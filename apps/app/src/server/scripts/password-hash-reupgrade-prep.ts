import type { Collection, Document, Filter } from 'mongodb';
import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger';

import {
  bothFilter,
  scopeFilter,
} from '../models/user/password-hash-format-filters';
import {
  exitAfterLogFlush,
  isEntryPoint,
  withMongoConnection,
} from './script-runner';

const logger = loggerFactory('growi:scripts:password-hash-reupgrade-prep');

export interface ReupgradePrepResult {
  /** number of `both` users (passwordHash + password) found — the target set. */
  both: number;
  /** number of documents from which the scrypt `passwordHash` was $unset. */
  unset: number;
}

/**
 * Prepare for RE-UPGRADING to the new (scrypt-aware) build AFTER a temporary
 * downgrade to a legacy SHA-256-only build.
 *
 * WHY this script exists — the stale-passwordHash resurrection hole:
 *
 * A user who logged in on the new build once is left in the `both` state by the
 * lazy migration: the legacy `password` (SHA-256 of their password) AND a
 * `passwordHash` (scrypt of the SAME password) coexist. That dual state is what
 * lets them keep authenticating across a downgrade — the old build reads only
 * `password`.
 *
 * But while running on the downgraded build the user can CHANGE their password.
 * The old build knows nothing about `passwordHash`, so it writes only the new
 * SHA-256 into `password` and leaves the OLD `passwordHash` untouched. The two
 * fields now disagree: `password` = current password, `passwordHash` = the
 * password from before the change.
 *
 * On re-upgrade, `PasswordHashService.verify()` ALWAYS prefers `passwordHash`
 * when present and never falls back to `password` (a deliberate design decision —
 * see design.md → "A changed/reset password is genuinely revoked"). So the user
 * would authenticate with their OLD (pre-change) password and be locked out of
 * their current one — and if that change was made because the old password
 * leaked, the leaked credential is silently revived. That is exactly the
 * credential-revocation hole the whole dual-field design exists to prevent, just
 * reached from the reverse (downgrade → change → re-upgrade) direction.
 *
 * THE FIX — run this once as part of the "return from a downgrade" procedure,
 * BEFORE the re-upgraded build starts accepting logins (i.e. while still on the
 * old build, or after deploying the new build but before opening it to traffic):
 * `$unset` the `passwordHash` of every `both` user, dropping them back to
 * `legacyOnly`. verify() then uses the legacy `password`, which the old build
 * kept current, and the next successful login re-runs lazy migration to rebuild a
 * `passwordHash` that matches.
 *
 * Running it AFTER the new build is already serving logins leaves a window in
 * which a `both` user whose password was changed on the old build still carries a
 * stale `passwordHash`, so verify() accepts the OLD (possibly leaked) password —
 * the exact hole this closes. Run it before that window opens.
 *
 * WHY ALL `both` USERS, unconditionally: a hash cannot be reversed, so we cannot
 * tell which `both` users actually changed their password on the old build. We
 * therefore reset every `both` user. This is harmless for the ones who did NOT
 * change it — their `password` and `passwordHash` still encode the same
 * password, so they simply re-migrate once on their next login.
 *
 * WHY NOT status-scoped (unlike downgrade-prep): every `both` user has a live
 * `password` field by definition, so removing `passwordHash` never strips a
 * user's only credential — there is no lockout risk for any status. downgrade-prep
 * needs its ACTIVE-only + reset-email safeguards precisely because it strips
 * `passwordHash` from `upgradedOnly` users who have NO other credential; this
 * script does not.
 *
 * IDEMPOTENT: after a run every target is `legacyOnly`, so a re-run finds zero
 * `both` users and writes nothing. Safe to run more than once.
 *
 * This function is the pure core: it takes the `users` collection as input and
 * returns a structured result (it never calls process.exit). The thin CLI entry
 * below translates the result into an exit code.
 *
 * Run manually by an admin:
 *   - development: `pnpm run password-hash:reupgrade-prep:dev`
 *     (= `pnpm run tsrun src/server/scripts/password-hash-reupgrade-prep.ts`)
 *   - production (Docker, built output): `pnpm run password-hash:reupgrade-prep`
 *     Always go through the npm script: it sets NODE_ENV=production and preloads
 *     `bin/runtime/env-preload.mjs` before `dist/server/scripts/…`. Invoking the
 *     built file with a bare `node` skips that preload.
 */
export async function runReupgradePrep(
  usersCollection: Collection,
  baseFilter: Filter<Document> = {},
): Promise<ReupgradePrepResult> {
  // `baseFilter` defaults to `{}` (whole collection) so `main()` and production
  // behavior are unchanged; a caller (integ test) may pass a scope to narrow the
  // count/write to a marker-seeded subset of the shared `users` collection.
  const scopedBothFilter = scopeFilter(baseFilter, bothFilter);

  const both = await usersCollection.countDocuments(scopedBothFilter);

  logger.info(
    `${both} user(s) are in the 'both' state (legacy password + scrypt passwordHash). Their passwordHash may be stale if their password was changed on a downgraded build, so it will be removed to force re-verification against the legacy password (and re-migration on the next login).`,
  );

  // NOT status-scoped on purpose: every `both` user still has a live legacy
  // `password`, so removing `passwordHash` cannot lock anyone out regardless of
  // status (see the WHY notes above).
  const updateResult = await usersCollection.updateMany(scopedBothFilter, {
    $unset: { passwordHash: '' },
  });

  logger.info(
    `Re-upgrade prep complete: removed the scrypt passwordHash from ${updateResult.modifiedCount} 'both' user(s). They are now legacyOnly and will re-migrate to scrypt on their next successful login.`,
  );

  return {
    both,
    unset: updateResult.modifiedCount,
  };
}

// ─── Thin CLI wrapper (only runs when executed as the entry point) ───────────

async function main(): Promise<void> {
  await withMongoConnection(async () => {
    await runReupgradePrep(mongoose.connection.collection('users'));
  });
}

if (isEntryPoint(import.meta.url)) {
  main()
    .catch((err) => {
      logger.error({ err }, 'password-hash reupgrade-prep script failed');
      process.exitCode = 1;
    })
    // This script drains the event loop on its own (no Crowi bootstrap), but a
    // natural exit races pino's transport worker: the completion line — the only
    // report an admin gets — was being dropped. Exit through the flush helper so
    // the outcome is always printed. Entry-point branch ONLY.
    .finally(() => {
      exitAfterLogFlush(
        logger,
        process.exitCode == null ? 0 : Number(process.exitCode),
      );
    });
}
