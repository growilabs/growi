import type { IUserHasId } from '@growi/core';
import { getIdForRef, getIdStringForRef } from '@growi/core';
import type { HydratedDocument } from 'mongoose';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import type { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting';
import type { PageDocument } from '~/server/models/page';
import { shouldGenerateUpdate } from '~/server/service/activity/update-activity-logic';
import type { GlobalNotificationEventVars } from '~/server/service/global-notification/types';
import { preNotifyService } from '~/server/service/pre-notify';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:page-save:page-notifications');

export type PageGlobalNotificationEvent =
  (typeof GlobalNotificationSettingEvent)[
    | 'PAGE_CREATE'
    | 'PAGE_EDIT'
    | 'PAGE_MOVE'
    | 'PAGE_DELETE'];

export const firePageGlobalNotification = async (
  crowi: Crowi,
  event: PageGlobalNotificationEvent,
  page: PageDocument,
  user: IUserHasId,
  vars?: GlobalNotificationEventVars,
): Promise<void> => {
  try {
    // Pass vars only when given so the call matches the routes' original
    // three-argument form and fire() keeps its own default.
    await (vars == null
      ? crowi.globalNotificationService.fire(event, page, user)
      : crowi.globalNotificationService.fire(event, page, user, vars));
  } catch (err) {
    logger.error({ err, event }, 'Global notification failed');
  }
};

export type EmitPageUpdateActivityArgs = {
  readonly activityId: string;
  readonly page: HydratedDocument<PageDocument>;
  readonly user: IUserHasId;
};

/**
 * Emit the PAGE_UPDATE activity unless the same user updated the page within
 * the suppression window. Returns whether it was emitted.
 *
 * Callers on a request path must await this BEFORE sending the response: the
 * listener takes the request context synchronously, and the response's
 * 'finish' clears it (see apps/app/.claude/rules/activity-recording.md).
 * Nothing is awaited between the decision and the emit for the same reason.
 */
export const emitPageUpdateActivity = async (
  crowi: Crowi,
  { activityId, page, user }: EmitPageUpdateActivityArgs,
): Promise<boolean> => {
  let shouldGenerateUpdateActivity = false;
  try {
    shouldGenerateUpdateActivity = await shouldGenerateUpdate({
      currentUserId: getIdStringForRef(user),
      targetPageId: getIdStringForRef(page),
      currentActivityId: activityId,
    });
  } catch (err) {
    logger.error(
      { err },
      'Failed to determine whether to generate update activity.',
    );
  }

  if (!shouldGenerateUpdateActivity) {
    return false;
  }

  try {
    const creator =
      page.creator != null ? getIdForRef(page.creator) : undefined;
    const parameters = {
      targetModel: SupportedTargetModel.MODEL_PAGE,
      target: page,
      action: SupportedAction.ACTION_PAGE_UPDATE,
      contributor: user,
    };
    crowi.events.activity.emit(
      'update',
      activityId,
      parameters,
      { path: page.path, creator },
      preNotifyService.generatePreNotify,
    );
  } catch (err) {
    logger.error({ err }, 'Failed to generate update activity');
    return false;
  }
  return true;
};
