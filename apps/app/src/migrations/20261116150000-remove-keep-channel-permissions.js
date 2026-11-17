import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:remove-keep-channel-permissions');

const COLLECTION_NAME = 'chat_channel_permissions';

/**
 * GROWI no longer offers the `keep` command, so its channel-permission rows
 * can neither be shown nor edited. deleteMany matches nothing on a second run
 * (or when the collection does not exist), so the migration is idempotent.
 */
export async function up(db) {
  logger.info('Apply migration');

  const { deletedCount } = await db
    .collection(COLLECTION_NAME)
    .deleteMany({ commandName: 'keep' });
  logger.info(`Removed ${deletedCount} keep channel-permission rows`);
}

/** The removed rows carried no information worth restoring. */
export async function down() {
  logger.info('Rollback migration: nothing to restore');
}
