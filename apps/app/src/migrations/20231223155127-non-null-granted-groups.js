import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory('growi:non-null-granted-groups');

export async function up(db, client) {
  logger.info('Apply migration');

  const pageCollection = await db.collection('pages');

  await pageCollection.updateMany({ grantedGroups: { $eq: null } }, [
    {
      $set: {
        grantedGroups: [],
      },
    },
  ]);

  logger.info('Migration has successfully applied');
}

export async function down(db, client) {
  // No rollback
}
