import mongoose from 'mongoose';

// eslint-disable-next-line import/no-named-as-default
import { Config } from '~/server/models/config';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:update-theme-color-for-dark');

module.exports = {
  async up(db, client) {
    logger.info('Apply migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    await Promise.all([
      await Config.findOneAndUpdate(
        { key: 'customize:theme', value: JSON.stringify('default-dark') },
        { value: JSON.stringify('default') },
      ), // update default-dark
      await Config.findOneAndUpdate(
        { key: 'customize:theme', value: JSON.stringify('blue-night') },
        { value: JSON.stringify('mono-blue') },
      ), // update blue-night
    ]);

    logger.info('Migration has successfully applied');
  },

  async down(db, client) {
    // do not rollback
  },
};
