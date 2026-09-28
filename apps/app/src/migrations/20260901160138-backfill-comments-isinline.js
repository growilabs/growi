import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

const logger = loggerFactory('growi:migrate:backfill-comments-isinline');

/**
 * Backfill `isInline: false` onto every `comments` document that predates
 * the inline-comment feature.
 *
 * WHY: `findCommentsByPageId` / `findCommentsByRevisionId` /
 * `countCommentByPageId` filter with `where: { isInline: { not: true } }` to
 * keep inline comments out of the page-footer thread/count. Prisma's MongoDB
 * connector does NOT match `{ not: true }` against a document where
 * `isInline` is entirely absent — only where it's explicitly stored as a
 * non-true value. Every pre-existing comment has no `isInline` field at all,
 * so without this backfill it becomes invisible from the comment thread and
 * count badge as soon as this feature ships (the same Mongo null-vs-absent
 * gotcha already fixed once for `InlineCommentService.create()`'s
 * `replyToId: null` write).
 *
 * `{ isInline: null }` matches BOTH an explicit `null` and a missing field in
 * MongoDB, and does NOT match `true`/`false` — so this backfill only ever
 * touches documents that genuinely lack the field, and is idempotent.
 */
export async function up() {
  logger.info('Apply migration: backfill comments.isInline');

  const result = await prisma.$runCommandRaw({
    update: 'comments',
    updates: [
      {
        q: { isInline: null },
        u: { $set: { isInline: false } },
        multi: true,
      },
    ],
  });

  logger.info('Migration has successfully applied', { result });
}

export async function down() {
  // Irreversible: the migration cannot distinguish documents it filled from
  // documents that already stored `isInline: false` explicitly, so a
  // rollback could incorrectly strip the field from documents the
  // inline-comment feature itself wrote. Intentionally a no-op.
}
