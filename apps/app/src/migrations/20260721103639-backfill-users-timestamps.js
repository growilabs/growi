import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

const logger = loggerFactory('growi:migrate:backfill-users-timestamps');

/**
 * Backfill missing `createdAt` / `updatedAt` on the `users` collection.
 *
 * WHY: `users.createdAt` / `users.updatedAt` are declared non-nullable in the
 * Prisma schema, and they are read via `include: { user: true }` from the
 * external-account listing (`prisma.externalaccounts.findAllWithPagination`).
 * Legacy user documents that predate the timestamps schema can lack these
 * fields, which makes Prisma throw P2032 ("... expected non-nullable type
 * DateTime, found incompatible value of null") when the related user is loaded
 * — surfaced to the admin as a 500 on /admin/users/external-accounts. This
 * backfill fills only the missing values so the fields stay not-null, rather
 * than loosening the schema to nullable.
 *
 * The backfill is expressed as an aggregation-pipeline update run through the
 * Prisma client (`$runCommandRaw`), following Prisma's script-based data
 * migration approach, while migrate-mongo provides the changelog / ordering /
 * boot-time execution that Prisma's MongoDB connector does not offer.
 */
export async function up() {
  logger.info('Apply migration: backfill users.createdAt / users.updatedAt');

  // `{ <field>: null }` matches BOTH an explicit null and a missing field in
  // MongoDB, so documents that already have a value are never touched — the
  // migration is idempotent and safe to re-run. The two updates run in order
  // within one command, so step 2 sees the createdAt filled by step 1.
  const result = await prisma.$runCommandRaw({
    update: 'users',
    updates: [
      // createdAt <- ObjectId generation time (an exact fact, not a guess)
      {
        q: { createdAt: null },
        u: [{ $set: { createdAt: { $toDate: '$_id' } } }],
        multi: true,
      },
      // updatedAt <- createdAt (the true last-update time is lost); fall back
      // to the generation time if createdAt is somehow still absent
      {
        q: { updatedAt: null },
        u: [
          {
            $set: {
              updatedAt: { $ifNull: ['$createdAt', { $toDate: '$_id' }] },
            },
          },
        ],
        multi: true,
      },
    ],
  });

  logger.info('Migration has successfully applied', { result });
}

export async function down() {
  // Irreversible: the migration cannot distinguish values it filled from values
  // that were already present, so a rollback could delete legitimate data.
  // Intentionally a no-op.
}
