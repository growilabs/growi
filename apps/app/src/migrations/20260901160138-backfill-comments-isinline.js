import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

const logger = loggerFactory('growi:migrate:backfill-comments-isinline');

/**
 * Backfill `isInline: false` onto every `comments` document that predates
 * the inline-comment feature (`.kiro/specs/inline-comment`).
 *
 * WHY: `findCommentsByPageId` / `findCommentsByRevisionId` /
 * `countCommentByPageId` (apps/app/src/features/comment/server/models/comment.ts)
 * filter with `where: { isInline: { not: true } }` to keep inline comments
 * out of the page-footer comment thread / count. Prisma's MongoDB connector
 * does NOT match `{ not: true }` (nor `NOT: { isInline: true }`, nor
 * `OR: [{ isInline: false }, { isInline: null }]`) against a document where
 * the `isInline` field is entirely absent from the underlying MongoDB
 * document — it only matches a document where the field is explicitly
 * stored as `false`/some non-true value. Every comment created before this
 * feature shipped has no `isInline` field at all, so without this backfill
 * every pre-existing comment becomes invisible from the page-footer comment
 * thread and vanishes from the comment count badge as soon as this feature
 * ships. This is the same Mongo-null-vs-absent gotcha already found and
 * fixed once for `InlineCommentService.create()`'s `replyToId: null` write
 * (see comments.ts's `data.replyToId` handling and this feature's
 * `list.integ.ts`) — this migration back-applies the same fix to the
 * earlier, different query added by task 1.3.
 *
 * `{ isInline: null }` matches BOTH an explicit `null` and a missing field
 * in MongoDB, and does NOT match a document that already stores `true` or
 * `false` — so this backfill only ever touches documents that genuinely
 * lack the field, and is idempotent / safe to re-run.
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
