import mongoose from 'mongoose';

import slackAppIntegrationFactory from '~/server/models/slack-app-integration';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:migrate:slack-app-integration-set-default-value',
);

module.exports = {
  async up(db) {
    logger.info('Apply migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    const SlackAppIntegration = slackAppIntegrationFactory();

    // Add togetter command if supportedCommandsForBroadcastUse already exists
    const slackAppIntegrations = await SlackAppIntegration.find();
    slackAppIntegrations.forEach(async (doc) => {
      if (
        doc.supportedCommandsForSingleUse != null &&
        !doc.supportedCommandsForSingleUse.includes('togetter')
      ) {
        doc.supportedCommandsForSingleUse.push('togetter');
      }
      await doc.save();
    });

    logger.info('Migration has successfully applied');
  },

  async down() {
    // no rollback
  },
};
