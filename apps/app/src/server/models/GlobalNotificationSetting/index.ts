import nodePath from 'node:path';
import { pathUtils } from '@growi/core/dist/utils';
import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';

import type { GlobalNotificationSettingType } from './consts';
import type {
  GlobalNotificationSettingDocument,
  GlobalNotificationSettingModel,
  IGlobalNotificationMailSetting,
  IGlobalNotificationSetting,
  IGlobalNotificationSlackSetting,
} from './types';

/**
 * parent schema for GlobalNotificationSetting model
 */
const globalNotificationSettingSchema = new mongoose.Schema<
  IGlobalNotificationSetting,
  GlobalNotificationSettingModel
>({
  isEnabled: { type: Boolean, required: true, default: true },
  triggerPath: { type: String, required: true },
  triggerEvents: { type: [String] },
});

/*
 * e.g. "/a/b/c" => ["/a/b/c", "/a/b", "/a", "/"]
 */
const generatePathsOnTree = (path: string, pathList: string[]): string[] => {
  pathList.push(path);

  if (path === '/') {
    return pathList;
  }

  const newPath = nodePath.posix.dirname(path);

  return generatePathsOnTree(newPath, pathList);
};

/*
 * e.g. "/a/b/c" => ["/a/b/c", "/a/b", "/a", "/"]
 */
const generatePathsToMatch = (originalPath: string): string[] => {
  const pathList = generatePathsOnTree(originalPath, []);
  return pathList.map((path) => {
    // except for the original trigger path ("/a/b/c"), append "*" to find all matches
    // e.g. ["/a/b/c", "/a/b", "/a", "/"] => ["/a/b/c", "/a/b/*", "/a/*", "/*"]
    if (path !== originalPath) {
      return `${pathUtils.addTrailingSlash(path)}*`;
    }

    return path;
  });
};

/**
 * GlobalNotificationSetting Class
 * @class GlobalNotificationSetting
 */
class GlobalNotificationSetting {
  static crowi: Crowi;

  crowi: Crowi;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
  }

  /**
   * enable notification setting
   */
  static async enable(
    this: GlobalNotificationSettingModel,
    id: string,
  ): Promise<GlobalNotificationSettingDocument> {
    // biome-ignore lint/complexity/noThisInStatic: 'this' refers to the mongoose model here, not the class defined in this file
    const setting = await this.findOne({ _id: id });

    if (setting == null) {
      throw new Error(`GlobalNotificationSetting with id ${id} not found`);
    }

    setting.isEnabled = true;
    await setting.save();

    return setting;
  }

  /**
   * disable notification setting
   */
  static async disable(
    this: GlobalNotificationSettingModel,
    id: string,
  ): Promise<GlobalNotificationSettingDocument> {
    // biome-ignore lint/complexity/noThisInStatic: 'this' refers to the mongoose model here, not the class defined in this file
    const setting = await this.findOne({ _id: id });

    if (setting == null) {
      throw new Error(`GlobalNotificationSetting with id ${id} not found`);
    }

    setting.isEnabled = false;
    await setting.save();

    return setting;
  }

  /**
   * find all notification settings
   */
  static async findAll(
    this: GlobalNotificationSettingModel,
  ): Promise<GlobalNotificationSettingDocument[]> {
    // biome-ignore lint/complexity/noThisInStatic: 'this' refers to the mongoose model here, not the class defined in this file
    const settings = await this.find().sort({
      triggerPath: 1,
    });

    return settings;
  }

  /**
   * find a list of notification settings by path and a list of events
   */
  static async findSettingByPathAndEvent(
    this: GlobalNotificationSettingModel,
    event: string,
    path: string,
    type: typeof GlobalNotificationSettingType.SLACK,
  ): Promise<
    (GlobalNotificationSettingDocument & IGlobalNotificationSlackSetting)[]
  >;
  static async findSettingByPathAndEvent(
    this: GlobalNotificationSettingModel,
    event: string,
    path: string,
    type: typeof GlobalNotificationSettingType.MAIL,
  ): Promise<
    (GlobalNotificationSettingDocument & IGlobalNotificationMailSetting)[]
  >;
  static async findSettingByPathAndEvent(
    this: GlobalNotificationSettingModel,
    event: string,
    path: string,
    type: string,
  ): Promise<GlobalNotificationSettingDocument[]> {
    const pathsToMatch = generatePathsToMatch(path);

    // biome-ignore lint/complexity/noThisInStatic: 'this' refers to the mongoose model here, not the class defined in this file
    const settings = await this.find({
      triggerPath: { $in: pathsToMatch },
      triggerEvents: event,
      __t: type,
      isEnabled: true,
    }).sort({ triggerPath: 1 });

    return settings;
  }
}

const factory = (crowi: Crowi): GlobalNotificationSettingModel => {
  GlobalNotificationSetting.crowi = crowi;
  globalNotificationSettingSchema.loadClass(GlobalNotificationSetting);
  return mongoose.model<
    IGlobalNotificationSetting,
    GlobalNotificationSettingModel
  >('GlobalNotificationSetting', globalNotificationSettingSchema);
};

export default factory;

// Re-export types and constants for external use
export {
  GlobalNotificationSettingEvent,
  GlobalNotificationSettingType,
} from './consts';
export type {
  GlobalNotificationMailSettingModel,
  GlobalNotificationSettingDocument,
  GlobalNotificationSettingModel,
  GlobalNotificationSlackSettingModel,
  IGlobalNotificationMailSetting,
  IGlobalNotificationSetting,
  IGlobalNotificationSlackSetting,
} from './types';

// Internal use only
export {
  GlobalNotificationSetting as class,
  globalNotificationSettingSchema as schema,
};
