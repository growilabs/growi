import GlobalNotificationSettingFactory from './GlobalNotificationSetting';
import Page from './page';

export const modelsDependsOnCrowi = {
  Page,
  PageTagRelation: require('./page-tag-relation'),
  User: require('./user'),
  Bookmark: require('./bookmark'),
  GlobalNotificationSetting: GlobalNotificationSettingFactory,
  GlobalNotificationMailSetting: require('./GlobalNotificationSetting/GlobalNotificationMailSetting'),
  GlobalNotificationSlackSetting: require('./GlobalNotificationSetting/GlobalNotificationSlackSetting'),
  SlackAppIntegration: require('./slack-app-integration'),
};

// setup models that independent from crowi
export * from './attachment';
export * as Activity from './activity';
export * as PageRedirect from './page-redirect';
export * from './revision';
export * as ShareLink from './share-link';
export * as Tag from './tag';
export * as UserGroup from './user-group';
export * as PageTagRelation from './page-tag-relation';

export * from './serializers';

export * from './GlobalNotificationSetting';
