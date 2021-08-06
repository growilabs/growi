import mongoose from 'mongoose';

import config from '^/config/migrate';
import { getModelSafely } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:remove-crowi-lauout');

module.exports = {
  async up(db) {
    logger.info('Apply migration');
    mongoose.connect(config.mongoUri, config.mongodb.options);

    const Page = getModelSafely('Page') || require('~/server/models/page')();

    const pages = await Page.find({ updatedAt: { $type: 'double' } });

    if (pages.length === 0) {
      return logger.info('The target page did not exist.');
    }

    const operations = pages.map((page) => {
      return {
        updateMany: {
          filter: { _id: page._id },
          update: { updatedAt: new Date(page.updatedAt) },
        },
      };
    });

    await Page.bulkWrite(operations);

    logger.info('Migration has successfully applied');

  },

  down(db) {
    // do not rollback
  },
};
