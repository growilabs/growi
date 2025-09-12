import type { Model } from 'mongoose';

import loggerFactory from '~/utils/logger';

import type Crowi from '.';

const logger = loggerFactory('growi:crowi:setup-models');

export type ModelsMapDependentOnCrowi = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [modelName: string]: Model<any>,
}

export const setupModelsDependentOnCrowi = async(crowi: Crowi): Promise<ModelsMapDependentOnCrowi> => {
  const modelsMap: ModelsMapDependentOnCrowi = {};

  const modelsDependsOnCrowi = {
    Page: (await import('../models/page')).default,
    User: (await import('../models/user')).default,
    Bookmark: (await import('../models/bookmark')).default,
    GlobalNotificationSetting: (await import('../models/GlobalNotificationSetting')).default,
    GlobalNotificationMailSetting: (await import('../models/GlobalNotificationSetting/GlobalNotificationMailSetting')).default,
    GlobalNotificationSlackSetting: (await import('../models/GlobalNotificationSetting/GlobalNotificationSlackSetting')).default,
    SlackAppIntegration: (await import('../models/slack-app-integration')).default,
  };

  Object.keys(modelsDependsOnCrowi).forEach((modelName) => {
    const factory = modelsDependsOnCrowi[modelName];

    if (!(factory instanceof Function)) {
      logger.warn(`modelsDependsOnCrowi['${modelName}'] is not a function. skipped.`);
      return;
    }

    modelsMap[modelName] = factory(crowi);
  });

  return modelsMap;
};

export const setupIndependentModels = async(): Promise<void> => {
  await Promise.all([
    import('~/features/comment/server/models'),
    import('~/features/external-user-group/server/models/external-user-group-relation'),
    import('~/features/external-user-group/server/models/external-user-group'),
    import('~/features/growi-plugin/server/models'),
    import('../models/activity'),
    import('../models/attachment'),
    import('../models/bookmark-folder'),
    import('../models/config'),
    import('../models/editor-settings'),
    import('../models/external-account'),
    import('../models/in-app-notification-settings'),
    import('../models/in-app-notification'),
    import('../models/named-query'),
    import('../models/page-operation'),
    import('../models/page-redirect'),
    import('../models/page-tag-relation'),
    import('../models/password-reset-order'),
    import('../models/revision'),
    import('../models/share-link'),
    import('../models/subscription'),
    import('../models/tag'),
    import('../models/transfer-key'),
    import('../models/update-post'),
    import('../models/user-group-relation'),
    import('../models/user-group'),
    import('../models/user-registration-order'),
    import('../models/user-ui-settings'),
    import('../models/access-token'),
  ]);
};
