import type { Model } from 'mongoose';
import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';

import {
  class as GlobalNotificationSettingClass,
  type GlobalNotificationSettingModel,
  schema as GlobalNotificationSettingSchema,
  type IGlobalNotificationSetting,
} from './GlobalNotificationSetting/index';

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
} as const;

/**
 * global notifcation type master
 */
export const GlobalNotificationSettingType = {
  MAIL: 'mail',
  SLACK: 'slack',
} as const;

const factory = (crowi: Crowi): GlobalNotificationSettingModel => {
  GlobalNotificationSettingClass.crowi = crowi;
  GlobalNotificationSettingSchema.loadClass(GlobalNotificationSettingClass);
  return mongoose.model<
    IGlobalNotificationSetting,
    GlobalNotificationSettingModel
  >('GlobalNotificationSetting', GlobalNotificationSettingSchema);
};

export default factory;
