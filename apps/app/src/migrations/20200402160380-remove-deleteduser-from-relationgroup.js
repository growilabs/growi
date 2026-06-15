import mongoose from 'mongoose';

import userModelFactory from '~/server/models/user/index.js';
import UserGroupRelation from '~/server/models/user-group-relation.js';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils.js';
import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory(
  'growi:migrate:remove-deleteduser-from-relationgroup',
);

export async function up(db) {
  logger.info('Apply migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  const User = userModelFactory();

  const deletedUsers = await User.find({ status: 4 }); // deleted user
  const requests = await UserGroupRelation.remove({
    relatedUser: deletedUsers,
  });

  if (requests.size === 0) {
    return logger.info('This migration terminates without any changes.');
  }
  logger.info('Migration has successfully applied');
}

export function down(db, next) {
  // do not rollback
  next();
}
