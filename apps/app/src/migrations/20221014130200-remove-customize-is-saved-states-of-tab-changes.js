import { Config } from '~/server/models/config.js';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils.js';
import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory('growi:migrate:remove-isSavedStatesOfTabChanges');

import mongoose from 'mongoose';

export async function up() {
  logger.info('Apply migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  await Config.findOneAndDelete({
    key: 'customize:isSavedStatesOfTabChanges',
  }); // remove isSavedStatesOfTabChanges

  logger.info('Migration has successfully applied');
}

export async function down() {
  logger.info('Rollback migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  const insertConfig = new Config({
    key: 'customize:isSavedStatesOfTabChanges',
    value: false,
  });

  await insertConfig.save();

  logger.info('Migration has been successfully rollbacked');
}
