import { resolve } from 'node:path';
import type { Collection } from 'mongodb';
import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger';

import { getMongoUri, mongoOptions } from '../util/mongoose-utils';

const logger = loggerFactory('growi:scripts:password-hash-cleanup');

export interface PasswordHashCleanupResult {
  /** true when the run aborted without touching the DB (legacyOnly users remain). */
  aborted: boolean;
  /** number of not-yet-migrated users (password only, no passwordHash). */
  legacyOnly: number;
  /** number of documents from which the legacy `password` field was $unset. */
  unset: number;
}

/**
 * Remove the legacy SHA-256 `password` field from fully-migrated users.
 *
 * WHY a standalone script (not a migrate-mongo migration): aborting here is a
 * hard requirement (Req 3.4), and a `throw`/exit during migrate-mongo's
 * boot-time auto-run would break the deployment. This is run manually by an
 * admin via `pnpm run tsrun src/server/scripts/password-hash-cleanup.ts`.
 *
 * This function is the pure core: it takes the `users` collection as input and
 * returns a structured result (it never calls process.exit). The thin CLI entry
 * below translates the result into an exit code.
 *
 * Steps:
 *  1. Count `legacyOnly` users (`password` set, `passwordHash` unset).
 *  2. If any exist, ABORT without writing (Req 3.4) — cleaning up now would
 *     leave those users unable to authenticate after a downgrade.
 *  3. Otherwise `$unset` the legacy `password` field from every `both` user
 *     (both fields present), keeping the scrypt `passwordHash` (Req 3.3).
 *
 * NOTE: `{ $exists: false }` relies on the invariant that these fields are never
 * stored as explicit `null` — all write paths `$unset` the field entirely, so
 * absence unambiguously means "not set".
 */
export async function runPasswordHashCleanup(
  usersCollection: Collection,
): Promise<PasswordHashCleanupResult> {
  const legacyOnly = await usersCollection.countDocuments({
    passwordHash: { $exists: false },
    password: { $exists: true },
  });

  if (legacyOnly > 0) {
    // Abort WITHOUT modifying the DB (Req 3.4).
    logger.error(
      `Aborting password-hash cleanup: ${legacyOnly} not-yet-migrated user(s) still have a legacy password but no passwordHash. No documents were modified. Let every user log in (lazy migration) until this count is 0 before running cleanup.`,
    );
    return { aborted: true, legacyOnly, unset: 0 };
  }

  const updateResult = await usersCollection.updateMany(
    { passwordHash: { $exists: true }, password: { $exists: true } },
    { $unset: { password: '' } },
  );

  logger.info(
    `Password-hash cleanup complete: removed the legacy password field from ${updateResult.modifiedCount} fully-migrated user(s).`,
  );

  return { aborted: false, legacyOnly: 0, unset: updateResult.modifiedCount };
}

// ─── Thin CLI wrapper (only runs when executed as the entry point) ───────────

const isEntryPoint = (): boolean => {
  const entry = process.argv[1];
  return (
    entry != null && resolve(entry) === resolve(import.meta.filename ?? '')
  );
};

export async function main(): Promise<void> {
  await mongoose.connect(getMongoUri(), mongoOptions);
  try {
    const result = await runPasswordHashCleanup(
      mongoose.connection.collection('users'),
    );
    process.exitCode = result.aborted ? 1 : 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (isEntryPoint()) {
  main().catch((err) => {
    logger.error('password-hash cleanup script failed:', err);
    process.exitCode = 1;
  });
}
