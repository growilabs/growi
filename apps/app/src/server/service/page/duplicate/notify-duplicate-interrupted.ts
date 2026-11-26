import type { IPage } from '@growi/core';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import { pageDuplicateInterruptedSnapshot } from '~/models/serializers/in-app-notification-snapshot/page-duplicate-interrupted';
import type { PreNotify } from '~/server/service/pre-notify';

import type { DuplicateDeps } from './duplicate-page-port';

export interface DuplicateInterruptedNotice {
  readonly userId: string;
  readonly copyTopPage: IPage & { _id: unknown };
  readonly fromPath: string;
  readonly toPath: string;
  readonly copiedPageCount: number;
  readonly sourcePageCount: number;
}

export const notifyDuplicateInterrupted = async (
  deps: Pick<DuplicateDeps, 'activityService' | 'activityEvent'>,
  input: DuplicateInterruptedNotice,
): Promise<void> => {
  const { activityService, activityEvent } = deps;
  const { userId, copyTopPage } = input;

  const activity = await activityService.createActivity({
    action: SupportedAction.ACTION_PAGE_DUPLICATE_INTERRUPTED,
    targetModel: SupportedTargetModel.MODEL_PAGE,
    target: copyTopPage,
    user: userId,
    snapshot: { username: '' },
  });
  if (activity == null) {
    return;
  }

  // Only the duplicating user is told; the default preNotify would also reach
  // subscribers of the copy top page.
  const preNotify: PreNotify = (props) => {
    props.notificationTargetUsers?.push(userId);
    return Promise.resolve();
  };

  const snapshot = pageDuplicateInterruptedSnapshot.stringify({
    path: copyTopPage.path,
    fromPath: input.fromPath,
    toPath: input.toPath,
    copiedPageCount: input.copiedPageCount,
    sourcePageCount: input.sourcePageCount,
  });

  activityEvent.emit('updated', activity, copyTopPage, preNotify, snapshot);
};
