import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

const logger = loggerFactory(
  'growi:migrate:remove-null-from-bookmarkfolders-bookmarks',
);

/**
 * Remove null elements from `bookmarkfolders.bookmarks`.
 *
 * WHY: `bookmarkfolders.bookmarkIds` (`bookmarks`) is a `String[]` in the
 * Prisma schema, and Prisma cannot declare nullable list elements, so a single
 * null element makes every read of that folder throw ("Error converting field
 * "bookmarkIds" of expected non-nullable type "String", found incompatible
 * value of "null"") — surfaced as a 500 on the owner's bookmark listings.
 * Only data written by v7 contains such nulls; current code never writes them.
 *
 * The filter matches only arrays that contain a null element. `{ bookmarks:
 * null }` would also match documents whose `bookmarks` field itself is null,
 * where `$pull` fails with "Cannot apply $pull to a non-array value" and stops
 * the update; those documents (and ones lacking the field) already read as
 * `[]` through Prisma and are left as they are. Idempotent.
 */
export async function up() {
  logger.info('Apply migration: remove null from bookmarkfolders.bookmarks');

  const result = await prisma.$runCommandRaw({
    update: 'bookmarkfolders',
    updates: [
      {
        q: { bookmarks: { $elemMatch: { $eq: null } } },
        u: { $pull: { bookmarks: null }, $inc: { __v: 1 } },
        multi: true,
      },
    ],
  });

  logger.info('Migration has successfully applied', { result });
}

export async function down() {
  // Irreversible: the removed nulls never referenced a bookmark, so there is
  // nothing meaningful to restore. Intentionally a no-op.
}
