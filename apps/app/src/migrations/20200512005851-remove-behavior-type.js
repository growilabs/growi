import mongoose from 'mongoose';

// eslint-disable-next-line import/no-named-as-default
import { Config } from '~/server/models/config';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:remove-behavior-type');

module.exports = {
  async up(db, client) {
    logger.info('Apply migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    await Config.findOneAndDelete({ key: 'customize:behavior' }); // remove behavior

    logger.info('Migration has successfully applied');
  },

  async down(db, client) {
    // do not rollback
    logger.info('Rollback migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    const insertConfig = new Config({
      key: 'customize:behavior',
      value: JSON.stringify('growi'),
    });

    await insertConfig.save();

    logger.info('Migration has been successfully rollbacked');
  },
};
