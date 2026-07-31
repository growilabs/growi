import { resolve } from 'node:path';
import type { Collection, Document, Filter } from 'mongodb';
import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger';

import {
  bothFilter,
  legacyOnlyFilter,
  scopeFilter,
} from '../models/user/password-hash-format-filters';
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
 * admin:
 *   - development: `pnpm run password-hash:cleanup:dev`
 *     (= `pnpm run tsrun src/server/scripts/password-hash-cleanup.ts`)
 *   - production (Docker, built output): `pnpm run password-hash:cleanup`
 *     (= `node dist/server/scripts/password-hash-cleanup.js`)
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
 * NOTE: classification uses the shared password-hash-format filters, which treat
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
    scopeFilter(baseFilter, legacyOnlyFilter),
  );

  if (legacyOnly > 0) {
    // Abort WITHOUT modifying the DB (Req 3.4).
    logger.error(
      `Aborting password-hash cleanup: ${legacyOnly} not-yet-migrated user(s) still have a legacy password but no passwordHash. No documents were modified. Let every user log in (lazy migration) until this count is 0 before running cleanup.`,
    );
    return { aborted: true, legacyOnly, unset: 0 };
  }

  const updateResult = await usersCollection.updateMany(
    scopeFilter(baseFilter, bothFilter),
    {
      $unset: { password: '' },
    },
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
