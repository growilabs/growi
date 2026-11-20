import { Config } from '~/server/models/config';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:remove-timeline-type');

import mongoose from 'mongoose';

export async function up(db, client) {
  logger.info('Apply migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  await Config.findOneAndDelete({ key: 'customize:isEnabledTimeline' }); // remove timeline

  logger.info('Migration has successfully applied');
}

export async function down(db, client) {
  // do not rollback
  logger.info('Rollback migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  const insertConfig = new Config({
    key: 'customize:isEnabledTimeline',
    value: true,
  });

  await insertConfig.save();

  logger.info('Migration has been successfully rollbacked');
}
