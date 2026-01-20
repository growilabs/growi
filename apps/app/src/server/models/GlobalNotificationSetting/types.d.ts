import type { HydratedDocument, Model } from 'mongoose';

import type Crowi from '~/server/crowi';

import type { GlobalNotificationSettingType } from './consts';

export interface IGlobalNotificationSetting {
  isEnabled: boolean;
  triggerPath: string;
  triggerEvents: string[];
}

export type GlobalNotificationSettingDocument =
  HydratedDocument<IGlobalNotificationSetting>;

export interface GlobalNotificationSettingModel
  extends Model<IGlobalNotificationSetting> {
  enable(id: string): Promise<GlobalNotificationSettingDocument>;
  disable(id: string): Promise<GlobalNotificationSettingDocument>;
  findAll(): Promise<GlobalNotificationSettingDocument[]>;
  findSettingByPathAndEvent(
    event: string,
    path: string,
    type: typeof GlobalNotificationSettingType.SLACK,
  ): Promise<
    (GlobalNotificationSettingDocument & IGlobalNotificationSlackSetting)[]
  >;
  findSettingByPathAndEvent(
    event: string,
    path: string,
    type: typeof GlobalNotificationSettingType.MAIL,
  ): Promise<
    (GlobalNotificationSettingDocument & IGlobalNotificationMailSetting)[]
  >;
}

export interface IGlobalNotificationMailSetting
  extends IGlobalNotificationSetting {
  toEmail: string;
}

export type GlobalNotificationMailSettingModel =
  Model<IGlobalNotificationMailSetting> & GlobalNotificationSettingModel;

export interface IGlobalNotificationSlackSetting
  extends IGlobalNotificationSetting {
  slackChannels: string;
}

export type GlobalNotificationSlackSettingModel =
  Model<IGlobalNotificationSlackSetting> & GlobalNotificationSettingModel;

/**
 * GlobalNotificationSetting Class
 * @class GlobalNotificationSetting
 */
export declare class GlobalNotificationSetting {
  static crowi: Crowi;
  crowi: Crowi;

  constructor(crowi: Crowi);
}
