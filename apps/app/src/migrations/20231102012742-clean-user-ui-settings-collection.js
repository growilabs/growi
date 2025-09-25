// eslint-disable-next-line import/no-named-as-default
import UserUISettings from '~/server/models/user-ui-settings';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:clean-user-ui-settings-collection');

const mongoose = require('mongoose');

module.exports = {
  async up() {
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
  },

  async down() {
    // No rollback
  },
};
