import mongoose from 'mongoose';

import type Crowi from '~/server/crowi/index.js';

import { GlobalNotificationSettingType } from './consts.js';
import {
  class as GlobalNotificationSettingClass,
  schema as GlobalNotificationSettingSchema,
} from './index.js';
import type {
  GlobalNotificationSettingModel,
  GlobalNotificationSlackSettingModel,
  IGlobalNotificationSetting,
  IGlobalNotificationSlackSetting,
} from './types.js';

const factory = (crowi: Crowi): GlobalNotificationSlackSettingModel => {
  GlobalNotificationSettingClass.crowi = crowi;
  GlobalNotificationSettingSchema.loadClass(GlobalNotificationSettingClass);

  const GlobalNotificationSettingModel = mongoose.model<
    IGlobalNotificationSetting,
    GlobalNotificationSettingModel
  >('GlobalNotificationSetting', GlobalNotificationSettingSchema);
  const GlobalNotificationSlackSettingModel =
    GlobalNotificationSettingModel.discriminator<
      IGlobalNotificationSlackSetting,
      GlobalNotificationSlackSettingModel
    >(
      GlobalNotificationSettingType.SLACK,
      new mongoose.Schema(
        {
          slackChannels: String,
        },
        {
          discriminatorKey: 'type',
        },
      ),
    );

  return GlobalNotificationSlackSettingModel;
};

export default factory;
