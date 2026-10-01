import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

const logger = loggerFactory('growi:migrate:recount-comment-count-inline');

/**
 * Recount `pages.commentCount` for every page that has inline comments, so
 * the stored value matches the new counting (every comment row counts).
 *
 * Pages without inline comments are left alone: their old count (normal
 * comments only) is already the count of all their rows. Each page's value is
 * recomputed from its rows, so re-running yields the same result.
 */
export async function up() {
  logger.info('Apply migration: recount pages.commentCount');

  const inlinePages = await prisma.comments.groupBy({
    by: ['pageId'],
    where: { isInline: true },
  });

  for (const { pageId } of inlinePages) {
    const count = await prisma.comments.countCommentByPageId(pageId);
    await prisma.pages.updateMany({
      where: { id: pageId },
      data: { commentCount: count },
    });
  }

  logger.info('Migration has successfully applied', {
    recountedPages: inlinePages.length,
  });
}
