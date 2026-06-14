import mongoose from 'mongoose';

import { Config } from '~/server/models/config.js';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils.js';
import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory('growi:migrate:remove-behavior-type');

export async function up(db, client) {
  logger.info('Apply migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  await Config.findOneAndDelete({ key: 'customize:behavior' }); // remove behavior

  logger.info('Migration has successfully applied');
}

export async function down(db, client) {
  // do not rollback
  logger.info('Rollback migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  const insertConfig = new Config({
    key: 'customize:behavior',
    value: JSON.stringify('growi'),
  });

  await insertConfig.save();

  logger.info('Migration has been successfully rollbacked');
}
