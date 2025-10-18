import mongoose from 'mongoose';

import { GlobalNotificationSettingType } from '../GlobalNotificationSetting';

const GlobalNotificationSetting = require('./index');

const GlobalNotificationSettingClass = GlobalNotificationSetting.class;
const GlobalNotificationSettingSchema = GlobalNotificationSetting.schema;

/** @param {import('~/server/crowi').default} crowi Crowi instance */
const factory = (crowi) => {
  GlobalNotificationSettingClass.crowi = crowi;
  GlobalNotificationSettingSchema.loadClass(GlobalNotificationSettingClass);

  const GlobalNotificationSettingModel = mongoose.model(
    'GlobalNotificationSetting',
    GlobalNotificationSettingSchema,
  );
  const GlobalNotificationMailSettingModel =
    GlobalNotificationSettingModel.discriminator(
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
