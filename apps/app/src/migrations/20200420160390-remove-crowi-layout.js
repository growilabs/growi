import mongoose from 'mongoose';

import { Config } from '~/server/models/config';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:remove-crowi-lauout');

module.exports = {
  async up(db) {
    logger.info('Apply migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    const query = { key: 'customize:layout', value: JSON.stringify('crowi') };

    await Config.findOneAndUpdate(query, { value: JSON.stringify('growi') }); // update layout

    logger.info('Migration has successfully applied');
  },

  down(db, next) {
    // do not rollback
    next();
  },
};
