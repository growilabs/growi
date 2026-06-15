import mongoose from 'mongoose';

import { Config } from '~/server/models/config.js';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils.js';
import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory('growi:migrate:update-configs-for-slackbot');

// key: oldKey, value: newKey
const keyMap = {
  'slackbot:proxyServerUri': 'slackbot:proxyUri',
  'slackbot:token': 'slackbot:withoutProxy:botToken',
  'slackbot:signingSecret': 'slackbot:withoutProxy:signingSecret',
};

export async function up(db) {
  logger.info('Apply migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  for await (const [oldKey, newKey] of Object.entries(keyMap)) {
    const isExist = (await Config.count({ key: newKey })) > 0;

    // remove old key
    if (isExist) {
      await Config.findOneAndRemove({ key: oldKey });
    }
    // update with new key
    else {
      await Config.findOneAndUpdate({ key: oldKey }, { key: newKey });
    }
  }

  logger.info('Migration has successfully applied');
}

export async function down(db) {
  logger.info('Rollback migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  for await (const [oldKey, newKey] of Object.entries(keyMap)) {
    const isExist = (await Config.count({ key: oldKey })) > 0;

    // remove new key
    if (isExist) {
      await Config.findOneAndRemove({ key: newKey });
    }
    // update with old key
    else {
      await Config.findOneAndUpdate({ key: newKey }, { key: oldKey });
    }
  }

  logger.info('Migration has successfully applied');
}
