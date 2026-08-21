import {
  bothFilter,
  legacyOnlyFilter,
  noPasswordFilter,
  scopeFilter,
  upgradedOnlyFilter,
} from '~/server/models/user/password-hash-format-filters';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

const logger = loggerFactory('growi:migrate:password-hash-status');

/**
 * Count and log the distribution of password-hash formats across the `users`
 * collection — a READ-ONLY progress report, performing NO writes (Req 3.1, 3.2).
 *
 * WHY: the password-hash upgrade stores credentials in two mutually-exclusive
 * fields — legacy SHA-256 `password` and adaptive-KDF `passwordHash`. Because a
 * document's format is decided purely by which of the two fields hold a real
 * value, an admin needs to see the migration progress before running the
 * (destructive) cleanup / downgrade-prep scripts. This only counts and logs the
 * four categories; it never modifies data, so it is always safe to (re-)run.
 *
 * `baseFilter` (default `{}` = whole collection) is AND-combined with each format
 * filter so a caller (integ test) can narrow every count to a marker-seeded
 * subset of the shared `users` collection. This lives in a SEPARATE exported
 * function — NOT `up()` — on purpose: migrate-mongo invokes the migration as
 * `up(db, client)`, so a leading `up(baseFilter)` param would capture the `db`
 * object, AND it into the query, and BSON-serialize the whole Db instance →
 * `RangeError: Maximum call stack size exceeded`. Keep the injectable filter off
 * the migrate-mongo entry point.
 *
 * NOTE: classification uses the shared password-hash-format filters, which treat
 * an empty string / `null` credential as ABSENT (not just `{ $exists: false }`).
 * `statusDelete()` scrubbed deleted users to `password: ''` on older builds, so a
 * lingering `password: ''` counts as `noPassword`, not `legacyOnly` — keeping the
 * report (and the cleanup script it gates) accurate.
 */
export async function reportPasswordHashFormatDistribution(baseFilter = {}) {
  logger.info(
    'Apply migration: report password-hash format distribution (read-only)',
  );

  const count = async (query) => {
    const result = await prisma.$runCommandRaw({ count: 'users', query });
    // `count` returns `{ n: <number>, ok: 1 }`
    return typeof result.n === 'number' ? result.n : 0;
  };

  const counts = {
    upgradedOnly: await count(scopeFilter(baseFilter, upgradedOnlyFilter)),
    both: await count(scopeFilter(baseFilter, bothFilter)),
    legacyOnly: await count(scopeFilter(baseFilter, legacyOnlyFilter)),
    noPassword: await count(scopeFilter(baseFilter, noPasswordFilter)),
  };

  logger.info('Password-hash format distribution:');
  logger.info(
    `  upgradedOnly (passwordHash only, fully migrated): ${counts.upgradedOnly}`,
  );
  logger.info(
    `  both         (both fields, migration in progress): ${counts.both}`,
  );
  logger.info(
    `  legacyOnly   (password only, not migrated):        ${counts.legacyOnly}`,
  );
  logger.info(
    `  noPassword   (neither field, no password set):     ${counts.noPassword}`,
  );
  // These counts cover every user regardless of status, but the cleanup script
  // only blocks on ACTIVE legacyOnly users (a suspended / invited / registered
  // user cannot be compelled to log in, so waiting for them would stall the
  // lifecycle forever). Without this note a non-zero legacyOnly here looks like
  // it contradicts a cleanup run that completes; cleanup reports its own split.
  logger.info(
    '  note: legacyOnly counts every status; the cleanup script only blocks on ACTIVE users',
  );

  // Returned for programmatic assertion (integ test); migrate-mongo ignores it.
  return counts;
}

/**
 * migrate-mongo entry point. migrate-mongo invokes this as `up(db, client)`; the
 * `_db` / `_client` arguments are intentionally ignored (this migration uses the
 * Prisma client, not migrate-mongo's `db`) and MUST NOT be forwarded as a query
 * filter — see the note on `reportPasswordHashFormatDistribution`. The params are
 * declared (and prefixed `_`) so the signature matches how migrate-mongo calls it.
 * Reports over the whole collection.
 */
export async function up(_db, _client) {
  await reportPasswordHashFormatDistribution();
}

export async function down() {
  // No-op: this migration only reads and reports counts, so there is nothing to
  // revert.
}
