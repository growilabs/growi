import { Config } from '~/server/models/config';
import userModelFactory from '~/server/models/user';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:add-installed-date-to-config');

const mongoose = require('mongoose');

module.exports = {
  async up() {
    logger.info('Apply migration');
    await mongoose.connect(getMongoUri(), mongoOptions);
    const User = userModelFactory();

    const appInstalled = await Config.findOne({ key: 'app:installed' });
    if (appInstalled != null && appInstalled.createdAt == null) {
      // Get the oldest user who probably installed this GROWI.
      const users = await User.find().limit(1).sort({ createdAt: 1 });
      const initialUserCreatedAt = users[0].createdAt;
      logger.debug('initialUserCreatedAt: ', initialUserCreatedAt);

      // Set app:installed date.
      // refs: https://mongoosejs.com/docs/6.x/docs/timestamps.html#disabling-timestamps
      //       Read the section after "Disabling timestamps also lets you set timestamps yourself..."
      const updatedConfig = await Config.findOneAndUpdate(
        { _id: appInstalled._id },
        { createdAt: initialUserCreatedAt },
        {
          new: true,
          timestamps: false,
          strict: false,
        },
      );
      logger.debug('updatedConfig: ', updatedConfig);
    }

    logger.info('Migration has successfully applied');
  },

  async down() {
    logger.info('Rollback migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    const appInstalled = await Config.findOne({ key: 'app:installed' });
    if (appInstalled != null) {
      // Unset app:installed date.
      const updatedConfig = await Config.findOneAndUpdate(
        { _id: appInstalled._id },
        { $unset: { createdAt: 1 } },
        {
          new: true,
          timestamps: false,
          strict: false,
        },
      );
      logger.debug('updatedConfig: ', updatedConfig);
    }

    logger.info('Migration has been successfully rollbacked');
  },
};
