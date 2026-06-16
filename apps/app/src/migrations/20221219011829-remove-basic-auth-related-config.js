import { Config } from '~/server/models/config';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:remove-basic-auth-related-config');

import mongoose from 'mongoose';

export async function up() {
  logger.info('Apply migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  await Config.findOneAndDelete({ key: 'security:passport-basic:isEnabled' });
  await Config.findOneAndDelete({
    key: 'security:passport-basic:isSameUsernameTreatedAsIdenticalUser',
  });

  logger.info('Migration has successfully applied');
}

export async function down() {
  // No rollback
}
