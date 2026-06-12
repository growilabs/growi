import type { Model } from 'mongoose';

import loggerFactory from '~/utils/logger';

import type Crowi from './index.js';

const logger = loggerFactory('growi:crowi:setup-models');

export type ModelsMapDependentOnCrowi = {
  [modelName: string]: Model<any>;
};

export const setupModelsDependentOnCrowi = async (
  crowi: Crowi,
): Promise<ModelsMapDependentOnCrowi> => {
  const modelsMap: ModelsMapDependentOnCrowi = {};

  const modelsDependsOnCrowi = {
    Page: (await import('../models/page.js')).default,
    User: (await import('../models/user/index.js')).default,
    Bookmark: (await import('../models/bookmark.js')).default,
    GlobalNotificationSetting: (
      await import('../models/GlobalNotificationSetting/index.js')
    ).default,
    GlobalNotificationMailSetting: (
      await import(
        '../models/GlobalNotificationSetting/GlobalNotificationMailSetting.js'
      )
    ).default,
    GlobalNotificationSlackSetting: (
      await import(
        '../models/GlobalNotificationSetting/GlobalNotificationSlackSetting.js'
      )
    ).default,
    SlackAppIntegration: (await import('../models/slack-app-integration.js'))
      .default,
  };

  Object.keys(modelsDependsOnCrowi).forEach((modelName) => {
    const factory = modelsDependsOnCrowi[modelName];

    if (!(factory instanceof Function)) {
      logger.warn(
        `modelsDependsOnCrowi['${modelName}'] is not a function. skipped.`,
      );
      return;
    }

    modelsMap[modelName] = factory(crowi);
  });

  return modelsMap;
};

export const setupIndependentModels = async (): Promise<void> => {
  await Promise.all([
    import('~/features/comment/server/models'),
    import(
      '~/features/external-user-group/server/models/external-user-group-relation'
    ),
    import('~/features/external-user-group/server/models/external-user-group'),
    import('~/features/growi-plugin/server/models'),
    import('../models/activity.js'),
    import('../models/attachment.js'),
    import('../models/bookmark-folder.js'),
    import('../models/config.js'),
    import('../models/editor-settings.js'),
    import('../models/external-account.js'),
    import('../models/in-app-notification-settings.js'),
    import('../models/in-app-notification.js'),
    import('../models/named-query.js'),
    import('../models/page-operation.js'),
    import('../models/page-redirect.js'),
    import('../models/page-tag-relation.js'),
    import('../models/password-reset-order.js'),
    import('../models/revision.js'),
    import('../models/share-link.js'),
    import('../models/subscription.js'),
    import('../models/tag.js'),
    import('../models/transfer-key.js'),
    import('../models/update-post.js'),
    import('../models/user-group-relation.js'),
    import('../models/user-group.js'),
    import('../models/user-registration-order.js'),
    import('../models/user-ui-settings.js'),
    import('../models/access-token.js'),
  ]);
};
