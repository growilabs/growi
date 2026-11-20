import mongoose from 'mongoose';

import userModelFactory from '~/server/models/user';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:migrate:set-sparse-option-to-slack-member-id',
);

export async function up(db) {
  logger.info('Apply migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  const User = userModelFactory();
  await User.syncIndexes();

  logger.info('Migration has successfully applied');
}

export function down(db) {
  // do not rollback
}
