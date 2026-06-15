import mongoose from 'mongoose';

import { Config } from '~/server/models/config.js';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils.js';
import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory('growi:migrate:update-theme-color-for-dark');

export async function up(db, client) {
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
}

export async function down(db, client) {
  // do not rollback
}
