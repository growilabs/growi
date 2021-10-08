import mongoose from 'mongoose';

import { getModelSafely, getMongoUri, mongoOptions } from '@growi/core';
import loggerFactory from '~/utils/logger';
import Config from '~/server/models/config';


const logger = loggerFactory('growi:migrate:slack-app-integration-rename-keys');

module.exports = {
  async up(db) {
    mongoose.connect(getMongoUri(), mongoOptions);

    const isExist = (await Config.count({ key: 'slackbot:withoutProxy:commandPermission' })) > 0;
    if (!isExist) return;

    const commandPermissionValue = await Config.findOne({ key: 'slackbot:withoutProxy:commandPermission' });
    // do nothing if data is 'null' or null
    if (commandPermissionValue._doc.value === 'null' || commandPermissionValue._doc.value == null) return;

    const commandPermission = JSON.parse(commandPermissionValue._doc.value);

    const newCommandPermission = {
      note: false,
      keep: false,
    };
    Object.entries(commandPermission).forEach((entry) => {
      const [key, value] = entry;
      switch (key) {
        case 'create':
          newCommandPermission.note = value;
          break;
        case 'togetter':
          newCommandPermission.keep = value;
          break;
        default:
          newCommandPermission[key] = value;
          break;
      }
    });

    await Config.findOneAndUpdate(
      { key: 'slackbot:withoutProxy:commandPermission' },
      {
        $set: {
          value: JSON.stringify(newCommandPermission),
        },
      },
    );

    logger.info('Migration has successfully applied');
  },

  async down(db, next) {
    mongoose.connect(getMongoUri(), mongoOptions);

    const isExist = (await Config.count({ key: 'slackbot:withoutProxy:commandPermission' })) > 0;
    if (!isExist) return next();

    const commandPermissionValue = await Config.findOne({ key: 'slackbot:withoutProxy:commandPermission' });
    // do nothing if data is 'null' or null
    if (commandPermissionValue._doc.value === 'null' || commandPermissionValue._doc.value == null) return next();

    const commandPermission = JSON.parse(commandPermissionValue._doc.value);

    const newCommandPermission = {
      create: false,
      togetter: false,
    };
    Object.entries(commandPermission).forEach((entry) => {
      const [key, value] = entry;
      switch (key) {
        case 'note':
          newCommandPermission.create = value;
          break;
        case 'keep':
          newCommandPermission.togetter = value;
          break;
        default:
          newCommandPermission[key] = value;
          break;
      }
    });

    await Config.findOneAndUpdate(
      { key: 'slackbot:withoutProxy:commandPermission' },
      {
        $set: {
          value: JSON.stringify(newCommandPermission),
        },
      },
    );

    next();
    logger.info('Migration rollback has successfully applied');
  },
};
