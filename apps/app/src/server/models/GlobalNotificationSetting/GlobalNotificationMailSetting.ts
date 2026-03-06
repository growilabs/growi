import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';

import { GlobalNotificationSettingType } from './consts';
import {
  class as GlobalNotificationSettingClass,
  schema as GlobalNotificationSettingSchema,
} from './index';
import type {
  GlobalNotificationMailSettingModel,
  GlobalNotificationSettingModel,
  IGlobalNotificationMailSetting,
  IGlobalNotificationSetting,
} from './types';

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
