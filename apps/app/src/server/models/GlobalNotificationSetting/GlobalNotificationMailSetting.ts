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

export interface IGlobalNotificationMailSetting
  extends IGlobalNotificationSetting {
  toEmail: string;
}

export type GlobalNotificationMailSettingModel =
  Model<IGlobalNotificationMailSetting> & GlobalNotificationSettingModel;

const factory = (crowi: Crowi): GlobalNotificationMailSettingModel => {
  GlobalNotificationSettingClass.crowi = crowi;
  GlobalNotificationSettingSchema.loadClass(GlobalNotificationSettingClass);

  const GlobalNotificationSettingModel = mongoose.model<
    IGlobalNotificationSetting,
    GlobalNotificationSettingModel
  >('GlobalNotificationSetting', GlobalNotificationSettingSchema);
  const GlobalNotificationMailSettingModel =
    GlobalNotificationSettingModel.discriminator<
      IGlobalNotificationMailSetting,
      GlobalNotificationMailSettingModel
    >(
      GlobalNotificationSettingType.MAIL,
      new mongoose.Schema(
        {
          toEmail: String,
        },
        {
          discriminatorKey: 'type',
        },
      ),
    );

  return GlobalNotificationMailSettingModel;
};

export default factory;
