import mongoose from 'mongoose';

import { Config } from '~/server/models/config';
import userModelFactory from '~/server/models/user';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:add-config-app-installed');

export async function up(db) {
  logger.info('Apply migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  const User = userModelFactory();

  // find 'app:installed'
  const appInstalled = await Config.findOne({
    key: 'app:installed',
  });
  // exit if exists
  if (appInstalled != null) {
    logger.info(
      "'app:appInstalled' is already exists. This migration terminates without any changes.",
    );
    return;
  }

  const userCount = await User.count();

  if (userCount > 0) {
    await Config.create({
      key: 'app:installed',
      value: true,
    });
  }

  logger.info('Migration has successfully applied');
}

export async function down(db) {
  logger.info('Rollback migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  // remote 'app:siteUrl'
  await Config.findOneAndDelete({
    key: 'app:installed',
  });

  logger.info('Migration has been successfully rollbacked');
}
