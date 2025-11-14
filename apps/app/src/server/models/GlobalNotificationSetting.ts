// disable no-return-await for model functions
/* eslint-disable no-return-await */

const mongoose = require('mongoose');

const GlobalNotificationSetting = require('./GlobalNotificationSetting/index');

const GlobalNotificationSettingClass = GlobalNotificationSetting.class;
const GlobalNotificationSettingSchema = GlobalNotificationSetting.schema;

/**
 * global notifcation event master
 */
export const GlobalNotificationSettingEvent = {
  PAGE_CREATE: 'pageCreate',
  PAGE_EDIT: 'pageEdit',
  PAGE_DELETE: 'pageDelete',
  PAGE_MOVE: 'pageMove',
  PAGE_LIKE: 'pageLike',
  COMMENT: 'comment',
};

/**
 * global notifcation type master
 */
export const GlobalNotificationSettingType = {
  MAIL: 'mail',
  SLACK: 'slack',
};

/** @param {import('~/server/crowi').default} crowi Crowi instance */
const factory = (crowi) => {
  GlobalNotificationSettingClass.crowi = crowi;
  GlobalNotificationSettingSchema.loadClass(GlobalNotificationSettingClass);
  return mongoose.model(
    'GlobalNotificationSetting',
    GlobalNotificationSettingSchema,
  );
};

export default factory;
