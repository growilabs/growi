import type { Model } from 'mongoose';
import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';

import { GlobalNotificationSettingType } from '../GlobalNotificationSetting';
import {
  class as GlobalNotificationSettingClass,
  type GlobalNotificationSettingModel,
  schema as GlobalNotificationSettingSchema,
  type IGlobalNotificationSetting,
} from './index';

export interface IGlobalNotificationSlackSetting
  extends IGlobalNotificationSetting {
  slackChannels: string;
}

export type GlobalNotificationSlackSettingModel =
  Model<IGlobalNotificationSlackSetting> & GlobalNotificationSettingModel;

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
