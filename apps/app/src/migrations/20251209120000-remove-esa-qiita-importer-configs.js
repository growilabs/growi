import mongoose from 'mongoose';

import { Config } from '~/server/models/config';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:remove-esa-qiita-importer-configs');

module.exports = {
  async up() {
    logger.info('Apply migration: Remove esa and qiita importer configs');
    await mongoose.connect(getMongoUri(), mongoOptions);

    const keysToDelete = [
      'importer:esa:team_name',
      'importer:esa:access_token',
      'importer:qiita:team_name',
      'importer:qiita:access_token',
    ];

    // Check if any configs exist before deletion
    const existingConfigs = await Config.countDocuments({
      key: {
        $in: keysToDelete,
      },
    });

    if (existingConfigs === 0) {
      logger.info('No configs to delete - migration not needed');
      return;
    }

    logger.info(`Found ${existingConfigs} config(s) to delete`);

    const result = await Config.deleteMany({
      key: {
        $in: keysToDelete,
      },
    });

    logger.info(
      `Migration completed: ${result.deletedCount} config(s) deleted`,
    );
  },

  async down() {
    logger.info('Rollback migration: Remove esa and qiita importer configs');
    // No rollback action - configs are intentionally removed
    logger.info('No rollback action needed');
  },
};
