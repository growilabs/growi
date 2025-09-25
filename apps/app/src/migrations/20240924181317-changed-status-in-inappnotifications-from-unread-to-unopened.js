import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:changed-status-in-inappnotifications-from-unread-to-unopened',
);

module.exports = {
  async up(db) {
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
  },

  async down() {
    // No rollback
  },
};
