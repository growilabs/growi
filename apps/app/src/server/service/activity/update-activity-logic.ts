import { getIdStringForRef } from '@growi/core';

import { SupportedAction } from '~/interfaces/activity';
import { prisma } from '~/utils/prisma';

type GenerateUpdatePayload = {
  currentUserId: string | undefined;
  targetPageId: string;
  currentActivityId: string;
};

const MINIMUM_REVISION_FOR_ACTIVITY = 2;
const SUPPRESION_UPDATE_WINDOW_MS = 5 * 60 * 1000; // 5 min

export const shouldGenerateUpdate = async (payload: GenerateUpdatePayload) => {
  const { targetPageId, currentActivityId, currentUserId } = payload;

  if (currentUserId == null) {
    return false;
  }

  // Get most recent update or create activity on the page
  const lastContentActivity = await prisma.activities.findFirst({
    where: {
      target: targetPageId,
      action: {
        in: [
          SupportedAction.ACTION_PAGE_CREATE,
          SupportedAction.ACTION_PAGE_UPDATE,
        ],
      },
      id: { not: currentActivityId },
    },
    orderBy: { createdAt: 'desc' },
  });

  const isLastActivityByMe =
    lastContentActivity != null &&
    lastContentActivity.userId != null &&
    getIdStringForRef(lastContentActivity.userId) === currentUserId;
  const lastActivityTime = lastContentActivity?.createdAt?.getTime?.() ?? 0;
  const timeSinceLastActivityMs = Date.now() - lastActivityTime;

  // Decide if update activity should generate
  let shouldGenerateUpdateActivity: boolean;
  if (!isLastActivityByMe) {
    shouldGenerateUpdateActivity = true;
  } else if (timeSinceLastActivityMs < SUPPRESION_UPDATE_WINDOW_MS) {
    shouldGenerateUpdateActivity = false;
  } else {
    const revisionCount = await prisma.revisions.count({
      where: { pageId: targetPageId },
    });

    shouldGenerateUpdateActivity =
      revisionCount > MINIMUM_REVISION_FOR_ACTIVITY;
  }

  return shouldGenerateUpdateActivity;
};
