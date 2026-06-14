import UserUISettings from '~/server/models/user-ui-settings.js';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils.js';
import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory('growi:migrate:clean-user-ui-settings-collection');

import mongoose from 'mongoose';

export async function up() {
  logger.info('Apply migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  await UserUISettings.updateMany(
    {},
    {
      $unset: {
        isSidebarCollapsed: '',
        preferDrawerModeByUser: '',
        preferDrawerModeOnEditByUser: '',
      },
    },
    { strict: false },
  );

  logger.info('Migration has successfully applied');
}

export async function down() {
  // No rollback
}
