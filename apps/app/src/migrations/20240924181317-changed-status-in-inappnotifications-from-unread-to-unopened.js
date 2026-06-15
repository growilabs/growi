import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory(
  'growi:changed-status-in-inappnotifications-from-unread-to-unopened',
);

export async function up(db) {
  logger.info('Apply migration');

  const unreadInAppnotifications = await db.collection('inappnotifications');
  await unreadInAppnotifications.updateMany({ status: { $eq: 'UNREAD' } }, [
    {
      $set: {
        status: 'UNOPENED',
      },
    },
  ]);

  logger.info('Migration has successfully applied');
}

export async function down() {
  // No rollback
}
