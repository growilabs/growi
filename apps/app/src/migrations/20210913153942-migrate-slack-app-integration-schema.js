import {
  defaultSupportedCommandsNameForBroadcastUse,
  defaultSupportedCommandsNameForSingleUse,
} from '@growi/slack';
import mongoose from 'mongoose';

import slackAppIntegrationFactory from '~/server/models/slack-app-integration';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:migrate:migrate-slack-app-integration-schema',
);

// create default data
const defaultDataForBroadcastUse = {};
defaultSupportedCommandsNameForBroadcastUse.forEach((commandName) => {
  defaultDataForBroadcastUse[commandName] = false;
});
const defaultDataForSingleUse = {};
defaultSupportedCommandsNameForSingleUse.forEach((commandName) => {
  defaultDataForSingleUse[commandName] = false;
});

module.exports = {
  async up(db) {
    logger.info('Apply migration');
    // connect only if disconnected
    // see: https://mongoosejs.com/docs/api/connection.html#connection_Connection-readyState
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(getMongoUri(), mongoOptions);
    }

    const SlackAppIntegration = slackAppIntegrationFactory();

    const slackAppIntegrations = await SlackAppIntegration.find();

    if (slackAppIntegrations.length === 0) return;

    // create operations
    const operations = slackAppIntegrations.map((doc) => {
      let copyForBroadcastUse = { ...defaultDataForBroadcastUse };
      let copyForSingleUse = { ...defaultDataForSingleUse };
      // when the document already has permissionsFor... colums
      if (doc._doc.permissionsForBroadcastUseCommands != null) {
        // merge
        copyForBroadcastUse = {
          ...defaultDataForBroadcastUse,
          ...Object.fromEntries(doc._doc.permissionsForBroadcastUseCommands),
        };
        copyForSingleUse = {
          ...defaultDataForSingleUse,
          ...Object.fromEntries(doc._doc.permissionsForSingleUseCommands),
        };
      }
      // when the document has supportedCommandsFor... columns
      else if (doc._doc.supportedCommandsForBroadcastUse != null) {
        // merge
        doc._doc.supportedCommandsForBroadcastUse.forEach((commandName) => {
          copyForBroadcastUse[commandName] = true;
        });
        doc._doc.supportedCommandsForSingleUse.forEach((commandName) => {
          copyForSingleUse[commandName] = true;
        });
      }
      // when the document does NOT have supportedCommandsFor... columns
      else {
        // turn on all
        defaultSupportedCommandsNameForBroadcastUse.forEach((commandName) => {
          copyForBroadcastUse[commandName] = true;
        });
        defaultSupportedCommandsNameForSingleUse.forEach((commandName) => {
          copyForSingleUse[commandName] = true;
        });
      }

      return {
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              permissionsForBroadcastUseCommands: copyForBroadcastUse,
              permissionsForSingleUseCommands: copyForSingleUse,
            },
            $unset: {
              supportedCommandsForBroadcastUse: '',
              supportedCommandsForSingleUse: '',
            },
          },
        },
      };
    });

    await db.collection('slackappintegrations').bulkWrite(operations);

    logger.info('Migration has successfully applied');
  },

  async down(db, next) {
    logger.info('Rollback migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    const SlackAppIntegration = slackAppIntegrationFactory();

    const slackAppIntegrations = await SlackAppIntegration.find();

    if (slackAppIntegrations.length === 0) return next();

    // create operations
    const operations = slackAppIntegrations.map((doc) => {
      const dataForBroadcastUse = [];
      const dataForSingleUse = [];
      doc.permissionsForBroadcastUseCommands.forEach((value, commandName) => {
        if (value === true) {
          dataForBroadcastUse.push(commandName);
        }
      });
      doc.permissionsForSingleUseCommands.forEach((value, commandName) => {
        if (value === true) {
          dataForSingleUse.push(commandName);
        }
      });

      return {
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              supportedCommandsForBroadcastUse: dataForBroadcastUse,
              supportedCommandsForSingleUse: dataForSingleUse,
            },
            $unset: {
              permissionsForBroadcastUseCommands: '',
              permissionsForSingleUseCommands: '',
            },
          },
        },
      };
    });

    await db.collection('slackappintegrations').bulkWrite(operations);

    next();
    logger.info('Migration has successfully applied');
  },
};
