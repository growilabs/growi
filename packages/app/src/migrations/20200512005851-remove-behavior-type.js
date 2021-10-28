import mongoose from 'mongoose';

import { getMongoUri, mongoOptions } from '@growi/core';
import Config from '~/server/models/config';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:remove-behavior-type');

module.exports = {
  async up(db, client) {
    logger.info('Apply migration');
    mongoose.connect(getMongoUri(), mongoOptions);

    await Config.findOneAndDelete({ key: 'customize:behavior' }); // remove behavior

    logger.info('Migration has successfully applied');
  },

  async down(db, client) {
    // do not rollback
    logger.info('Rollback migration');
    mongoose.connect(getMongoUri(), mongoOptions);

    const insertConfig = new Config({
      ns: 'crowi',
      key: 'customize:behavior',
      value: JSON.stringify('growi'),
    });

    await insertConfig.save();

    logger.info('Migration has been successfully rollbacked');
  },
};
