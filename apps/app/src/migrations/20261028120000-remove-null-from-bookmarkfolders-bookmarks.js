import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

const logger = loggerFactory(
  'growi:migrate:remove-null-from-bookmarkfolders-bookmarks',
);

/**
 * Remove null elements from `bookmarkfolders.bookmarks`, and turn a
 * `bookmarks` field that is itself null into an empty array.
 *
 * WHY: `bookmarkfolders.bookmarkIds` (`bookmarks`) is a `String[]` in the
 * Prisma schema, and Prisma cannot declare nullable list elements, so a single
 * null element makes every read of that folder throw ("Error converting field
 * "bookmarkIds" of expected non-nullable type "String", found incompatible
 * value of "null"") — surfaced as a 500 on the owner's bookmark listings.
 * Only data written by v7 contains such nulls; current code never writes them.
 *
 * A field that is itself null reads as `[]` through Prisma, but `$pull` /
 * `$addToSet` on it fail with "Cannot apply ... to a non-array value", which
 * breaks moving a bookmark between the owner's folders. A missing field needs
 * no change: both operators treat it as an empty array.
 *
 * Each filter matches only its own shape. `{ bookmarks: null }` would also
 * match a null field (where `$pull` fails and stops the update), and
 * `{ bookmarks: { $type: 'null' } }` would also match an array containing a
 * null element (which `$set: []` would wipe). Idempotent.
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
      {
        q: { $expr: { $eq: [{ $type: '$bookmarks' }, 'null'] } },
        u: { $set: { bookmarks: [] }, $inc: { __v: 1 } },
        multi: true,
      },
    ],
  });

  // $runCommandRaw returns per-document failures in the reply (ok: 1) instead
  // of throwing; fail so migrate-mongo does not record this as applied.
  if (result.writeErrors != null || result.writeConcernError != null) {
    throw new Error(
      `Failed to remove null from bookmarkfolders.bookmarks: ${JSON.stringify(result)}`,
    );
  }

  logger.info('Migration has successfully applied', { result });
}

export async function down() {
  // Irreversible: the removed nulls never referenced a bookmark, and a null
  // field and an empty array mean the same thing, so there is nothing
  // meaningful to restore. Intentionally a no-op.
}
