import { Config } from '~/server/models/config.js';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils.js';
import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory(
  'growi:migrate:remove-presentation-configurations',
);

import mongoose from 'mongoose';

export async function up() {
  logger.info('Apply migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  await Config.findOneAndDelete({
    key: 'markdown:presentation:pageBreakSeparator',
  });
  await Config.findOneAndDelete({
    key: 'markdown:presentation:pageBreakCustomSeparator',
  });

  logger.info('Migration has successfully applied');
}

export async function down() {
  logger.info('Rollback migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  const insertConfig = new Config({
    key: 'markdown:presentation:pageBreakSeparator',
    value: 2,
  });

  await insertConfig.save();

  logger.info('Migration has been successfully rollbacked');
}
