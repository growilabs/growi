import {
  bothFilter,
  legacyOnlyFilter,
  noPasswordFilter,
  upgradedOnlyFilter,
} from '~/server/models/user/password-hash-format-filters';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

const logger = loggerFactory('growi:migrate:password-hash-status');

/**
 * Report the distribution of password-hash formats across the `users`
 * collection — a READ-ONLY progress report, performing NO writes (Req 3.1, 3.2).
 *
 * WHY: the password-hash upgrade stores credentials in two mutually-exclusive
 * fields — legacy SHA-256 `password` and adaptive-KDF `passwordHash`. Because a
 * document's format is decided purely by which of the two fields exist, an
 * admin needs to see the migration progress before running the (destructive)
 * cleanup / downgrade-prep scripts. This migration only counts and logs the
 * four categories; it never modifies data, so it is always safe to (re-)run.
 *
 * The counts are expressed through the Prisma client (`$runCommandRaw` with the
 * `count` command), matching the repo's prisma-based migration style, while
 * migrate-mongo provides the changelog / ordering / boot-time execution that
 * Prisma's MongoDB connector does not offer.
 *
 * NOTE: classification uses the shared password-hash-format filters, which treat
 * an empty string / `null` credential as ABSENT (not just `{ $exists: false }`).
 * `statusDelete()` scrubbed deleted users to `password: ''` on older builds, so a
 * lingering `password: ''` counts as `noPassword`, not `legacyOnly` — keeping the
 * report (and the cleanup script it gates) accurate.
 */
export async function up() {
  logger.info('Apply migration: report password-hash format distribution (read-only)');

  const count = async (query) => {
    const result = await prisma.$runCommandRaw({ count: 'users', query });
    // `count` returns `{ n: <number>, ok: 1 }`
    return typeof result.n === 'number' ? result.n : 0;
  };

  const counts = {
    // fully migrated: adaptive-KDF only
    upgradedOnly: await count(upgradedOnlyFilter),
    // in progress: both formats present
    both: await count(bothFilter),
    // not migrated: legacy SHA-256 only
    legacyOnly: await count(legacyOnlyFilter),
    // no password set (external-auth-only, not-yet-activated, or scrubbed users)
    noPassword: await count(noPasswordFilter),
  };

  logger.info('Password-hash format distribution:');
  logger.info(`  upgradedOnly (passwordHash only, fully migrated): ${counts.upgradedOnly}`);
  logger.info(`  both         (both fields, migration in progress): ${counts.both}`);
  logger.info(`  legacyOnly   (password only, not migrated):        ${counts.legacyOnly}`);
  logger.info(`  noPassword   (neither field, no password set):     ${counts.noPassword}`);

  // Returned for programmatic assertion (integ test); migrate-mongo ignores it.
  return counts;
}

export async function down() {
  // No-op: this migration only reads and reports counts, so there is nothing to
  // revert.
}
