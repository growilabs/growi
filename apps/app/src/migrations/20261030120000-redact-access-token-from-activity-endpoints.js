import { redactAccessTokenFromEndpoint } from '~/server/util/redact-access-token-from-endpoint';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

const logger = loggerFactory(
  'growi:migrate:redact-access-token-from-activity-endpoints',
);

const BATCH_SIZE = 1000;

/**
 * Redact `access_token` values left in `activities.endpoint` by rows saved
 * before the activity model started redacting on save. The audit log list
 * shows the stored endpoint as-is, so these rows expose the token to admins.
 *
 * Every row with a query string is read and passed through the same
 * redactAccessTokenFromEndpoint the model uses (a substring filter would miss
 * a percent-encoded key such as `access%5Ftoken`); only rows whose value
 * changes are written, so re-running is a no-op.
 */
export async function up() {
  logger.info('Apply migration: redact access_token from activities.endpoint');

  let cursorId;
  let redactedCount = 0;

  for (;;) {
    const rows = await prisma.activities.findMany({
      where: { endpoint: { contains: '?' } },
      select: { id: true, endpoint: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursorId == null ? {} : { cursor: { id: cursorId }, skip: 1 }),
    });
    if (rows.length === 0) break;

    const updates = rows.flatMap(({ id, endpoint }) => {
      const redacted = redactAccessTokenFromEndpoint(endpoint);
      return redacted === endpoint
        ? []
        : [{ q: { _id: { $oid: id } }, u: { $set: { endpoint: redacted } } }];
    });
    if (updates.length > 0) {
      await prisma.$runCommandRaw({ update: 'activities', updates });
      redactedCount += updates.length;
    }

    cursorId = rows[rows.length - 1].id;
  }

  logger.info('Migration has successfully applied', { redactedCount });
}

export async function down() {
  // Irreversible: the redacted token values are not kept anywhere.
}
