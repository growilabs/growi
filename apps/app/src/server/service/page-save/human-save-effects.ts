import type { IUserHasId } from '@growi/core';
import { Origin } from '@growi/core';
import type { HydratedDocument } from 'mongoose';

import { subscribeRuleNames } from '~/interfaces/in-app-notification';
import type Crowi from '~/server/crowi';
import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting';
import type { PageDocument } from '~/server/models/page';
import { getYjsService } from '~/server/service/yjs';
import loggerFactory from '~/utils/logger';

import { firePageGlobalNotification } from './page-notifications';

const logger = loggerFactory('growi:service:page-save:human-save-effects');

type SlackOptions = {
  readonly isSlackEnabled?: boolean;
  readonly slackChannels?: string;
};

export type HumanUpdateEffectArgs = SlackOptions & {
  readonly pageId: string;
  readonly page: HydratedDocument<PageDocument>;
  readonly user: IUserHasId;
  readonly origin: Origin | undefined;
  readonly previousRevision: { readonly body: string } | null;
};

export type HumanCreateEffectArgs = SlackOptions & {
  readonly page: HydratedDocument<PageDocument>;
  readonly user: IUserHasId;
};

export const runAfterHumanUpdate = async (
  crowi: Crowi,
  args: HumanUpdateEffectArgs,
): Promise<void> => {
  const { pageId, page, user, origin, previousRevision } = args;

  // Reflect the updates in ydoc
  if (origin === Origin.View || origin === undefined) {
    const yjsService = getYjsService();
    await yjsService.syncWithTheLatestRevisionForce(pageId);
  }

  await firePageGlobalNotification(
    crowi,
    GlobalNotificationSettingEvent.PAGE_EDIT,
    page,
    user,
  );

  const { isSlackEnabled, slackChannels } = args;
  if (isSlackEnabled) {
    try {
      const option =
        previousRevision != null ? { previousRevision } : undefined;
      const results = await crowi.userNotificationService.fire(
        page,
        user,
        slackChannels,
        'update',
        option,
      );
      for (const result of results) {
        if (result.status === 'rejected') {
          logger.error(
            { err: result.reason },
            'Create user notification failed',
          );
        }
      }
    } catch (err) {
      logger.error({ err }, 'Create user notification failed');
    }
  }
};

export const runAfterHumanCreate = async (
  crowi: Crowi,
  args: HumanCreateEffectArgs,
): Promise<void> => {
  const { page, user, isSlackEnabled, slackChannels } = args;

  await firePageGlobalNotification(
    crowi,
    GlobalNotificationSettingEvent.PAGE_CREATE,
    page,
    user,
  );

  if (isSlackEnabled) {
    try {
      const results = await crowi.userNotificationService.fire(
        page,
        user,
        slackChannels,
        'create',
      );
      for (const result of results) {
        if (result.status === 'rejected') {
          logger.error(
            { err: result.reason },
            'Create user notification failed',
          );
        }
      }
    } catch (err) {
      logger.error({ err }, 'Create user notification failed');
    }
  }

  try {
    await crowi.inAppNotificationService.createSubscription(
      user._id,
      page._id,
      subscribeRuleNames.PAGE_CREATE,
    );
  } catch (err) {
    logger.error({ err }, 'Failed to create subscription document');
  }
};
