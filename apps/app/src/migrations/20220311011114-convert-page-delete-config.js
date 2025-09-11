import mongoose from 'mongoose';

import {
  PageRecursiveDeleteCompConfigValue,
  PageRecursiveDeleteConfigValue,
} from '~/interfaces/page-delete-config';
import { Config } from '~/server/models/config';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:convert-page-delete-config');

module.exports = {
  async up(db, client) {
    await mongoose.connect(getMongoUri(), mongoOptions);

    const isNewConfigExists =
      (await Config.count({
        key: 'security:pageDeletionAuthority',
      })) > 0;

    if (isNewConfigExists) {
      logger.info('This migration is skipped because new configs are existed.');
      logger.info('Migration has successfully applied');
      return;
    }

    const oldConfig = await Config.findOne({
      key: 'security:pageCompleteDeletionAuthority',
    });

    const oldValue = oldConfig?.value ?? '"anyOne"';

    try {
      await Config.insertMany([
        {
          key: 'security:pageDeletionAuthority',
          value: oldValue,
        },
        {
          key: 'security:pageRecursiveDeletionAuthority',
          value: `"${PageRecursiveDeleteConfigValue.Inherit}"`,
        },
        {
          key: 'security:pageRecursiveCompleteDeletionAuthority',
          value: `"${PageRecursiveDeleteCompConfigValue.Inherit}"`,
        },
      ]);
    } catch (err) {
      logger.error('Failed to migrate page delete configs', err);
      throw err;
    }

    logger.info('Migration has successfully applied');
  },

  async down(db, client) {
    logger.info('Migration down has successfully applied');
  },
};
