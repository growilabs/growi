import { getIdStringForRef } from '@growi/core';

import type Crowi from '~/server/crowi';
import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting/consts';
import {
  beginActivity,
  pendingActivityContext,
} from '~/server/service/activity/index';
import {
  emitPageUpdateActivity,
  firePageGlobalNotification,
  updatePageBody,
} from '~/server/service/page-save';
import { normalizeLatestRevisionIfBroken } from '~/server/service/revision/normalize-latest-revision-if-broken';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import { toRevisionProposalMark } from '../../domain';
import { pageModel } from './page-model';
import type {
  OperationContext,
  OperationHandler,
  OperationOutcome,
  OperationRecordOf,
} from './types';

const logger = loggerFactory(
  'growi:features:change-proposal:operation-handlers:edit',
);

type EditOperation = OperationRecordOf<'edit'>;

// A marked revision can exist without ever having been the page's revision:
// pushRevision creates it before the conditional page update, and a lost update
// whose cleanup fails, or a run stopped in between, leaves it behind. It counts
// as applied only when the page points to it now, or when the revision just
// before it is the base (the page moved from base to it, then was edited on).
const findAdoptedMarkedRevisionId = async (
  op: EditOperation,
  ctx: OperationContext,
): Promise<string | null> => {
  const marked = await prisma.revisions.findMany({
    where: {
      proposalId: ctx.proposalId,
      proposalOperationKey: op.key,
      pageId: op.pageId,
    },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  if (marked.length === 0) {
    return null;
  }

  const page = await pageModel().findById(op.pageId, { revision: 1 });
  const currentRevisionId =
    page?.revision == null ? null : getIdStringForRef(page.revision);
  if (currentRevisionId === op.baseRevisionId) {
    return null;
  }
  const current = marked.find((revision) => revision.id === currentRevisionId);
  if (current != null) {
    return current.id;
  }
  if (page == null) {
    return null;
  }

  for (const revision of marked) {
    // biome-ignore lint/performance/noAwaitInLoops: almost always a single marked revision
    const predecessor = await prisma.revisions.findFirst({
      where: { pageId: op.pageId, createdAt: { lt: revision.createdAt } },
      select: { id: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (predecessor?.id === op.baseRevisionId) {
      return revision.id;
    }
  }
  return null;
};

export const createEditHandler = (
  crowi: Crowi,
): OperationHandler<EditOperation> => ({
  async findExistingResult(op, ctx) {
    const revisionId = await findAdoptedMarkedRevisionId(op, ctx);
    if (revisionId == null) {
      return null;
    }
    return {
      status: 'applied',
      resultPageId: op.pageId,
      resultRevisionId: revisionId,
    };
  },

  async execute(op, ctx): Promise<OperationOutcome> {
    const page = await pageModel().findByIdAndViewer(op.pageId, ctx.requester);
    if (page == null) {
      return { status: 'failed', reason: 'target-unavailable' };
    }
    // Human saves run this in the route; once a newer revision exists it can no longer repair the base.
    await normalizeLatestRevisionIfBroken(op.pageId);

    const result = await updatePageBody(
      { pageService: crowi.pageService },
      {
        mode: 'proposal',
        page,
        body: op.body,
        user: ctx.requester,
        expectedRevisionId: op.baseRevisionId,
        proposalMark: toRevisionProposalMark({
          proposalId: ctx.proposalId,
          operationKey: op.key,
        }),
      },
    );
    if (result.type === 'conflict') {
      return { status: 'stale', reason: 'base-revision-changed' };
    }
    return {
      status: 'applied',
      resultPageId: op.pageId,
      resultRevisionId:
        result.page.revision == null
          ? null
          : getIdStringForRef(result.page.revision),
    };
  },

  async sendPerPageNotifications(_op, outcome, ctx) {
    try {
      const page = await pageModel().findById(outcome.resultPageId);
      if (page == null) {
        return;
      }
      const { requester, activityParameters } = ctx;
      const { activityId } = beginActivity({
        ip: activityParameters.ip,
        endpoint: activityParameters.endpoint,
        userId: requester._id.toString(),
        username: requester.username,
        createdAt: new Date(),
      });
      let emitted = false;
      try {
        emitted = await emitPageUpdateActivity(crowi, {
          activityId,
          page,
          user: requester,
        });
      } finally {
        if (!emitted) {
          pendingActivityContext.clear(activityId);
        }
      }
      await firePageGlobalNotification(
        crowi,
        GlobalNotificationSettingEvent.PAGE_EDIT,
        page,
        requester,
      );
    } catch (err) {
      logger.error(
        { err, proposalId: ctx.proposalId, operationKey: ctx.operationKey },
        'Failed to send per-page notifications for an applied edit',
      );
    }
  },
});
