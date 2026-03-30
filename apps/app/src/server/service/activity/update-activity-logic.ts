import type { IRevisionHasId } from '@growi/core';
import mongoose from 'mongoose';

import { SupportedAction } from '~/interfaces/activity';

type GenerateUpdatePayload = {
  currentUserId: string;
  targetPageId: string;
  latestSupportedActivityId: string;
};

const MINIMUM_REVISION_FOR_ACTIVITY = 2;
const SUPPRESION_UPDATE_WINDOW_MS = 1 * 10 * 1000; // 5 min

export const shouldGenerateUpdate = async (payload: GenerateUpdatePayload) => {
  const { targetPageId, latestSupportedActivityId, currentUserId } = payload;
  const Activity = mongoose.model('Activity');

  // Get most recent update or create activity on the page
  const lastContentActivity = await Activity.findOne({
    target: targetPageId,
    action: {
      $in: [
        SupportedAction.ACTION_PAGE_CREATE,
        SupportedAction.ACTION_PAGE_UPDATE,
      ],
    },
    _id: { $ne: latestSupportedActivityId },
  }).sort({ createdAt: -1 });

  const isLastActivityByMe =
    !!currentUserId &&
    lastContentActivity?.user?._id?.toString() === currentUserId;

  const lastActivityTime = lastContentActivity?.createdAt?.getTime?.() ?? 0;
  const timeSinceLastActivityMs = Date.now() - lastActivityTime;

  // Decide if update activity should generate
  let shouldGenerateUpdateActivity: boolean;
  if (!isLastActivityByMe) {
    shouldGenerateUpdateActivity = true;
  } else if (timeSinceLastActivityMs < SUPPRESION_UPDATE_WINDOW_MS) {
    shouldGenerateUpdateActivity = false;
  } else {
    const Revision = mongoose.model<IRevisionHasId>('Revision');
    const revisionCount = await Revision.countDocuments({
      pageId: targetPageId,
    });

    shouldGenerateUpdateActivity =
      revisionCount > MINIMUM_REVISION_FOR_ACTIVITY;
  }

  return shouldGenerateUpdateActivity;
};
