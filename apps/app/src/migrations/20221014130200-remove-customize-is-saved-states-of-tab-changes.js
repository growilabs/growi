import { Config } from '~/server/models/config';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

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
