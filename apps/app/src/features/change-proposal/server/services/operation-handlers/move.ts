import type Crowi from '~/server/crowi';
import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting/consts';
import { findUserPageWriteRefusal } from '~/server/service/page/user-page-write-guard';
import { firePageGlobalNotification } from '~/server/service/page-save';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import { isMovableSourcePath } from '../../domain';
import { classifyCreateError } from './classify-create-error';
import { isPathOccupied, pageModel } from './page-model';
import type {
  AppliedOutcome,
  OperationHandler,
  OperationOutcome,
  OperationRecordOf,
} from './types';

const logger = loggerFactory(
  'growi:features:change-proposal:operation-handlers:move',
);

type MoveOperation = OperationRecordOf<'move'>;

const appliedMove = (op: MoveOperation): AppliedOutcome => ({
  status: 'applied',
  resultPageId: op.pageId,
  resultRevisionId: null,
});

// Only a revert move carries removeRedirectsFrom: the redirects the original
// move left at the path the page returns to would otherwise hide the page.
const removeRedirectsLeftByOriginalMove = async (
  op: MoveOperation,
): Promise<void> => {
  if (op.removeRedirectsFrom == null) {
    return;
  }
  await prisma.pageredirects.deleteRedirectsFromPathTree(
    op.removeRedirectsFrom,
  );
};

export const createMoveHandler = (
  crowi: Crowi,
): OperationHandler<MoveOperation> => ({
  // The redirect removal is idempotent, so a run stopped between the move and
  // the removal is finished here rather than reported as applied with the
  // original path still redirecting away.
  async findExistingResult(op) {
    const page = await pageModel().findById(op.pageId, { path: 1 });
    if (page == null || page.path !== op.toPath) {
      return null;
    }
    await removeRedirectsLeftByOriginalMove(op);
    return appliedMove(op);
  },

  async execute(op, ctx): Promise<OperationOutcome> {
    const page = await pageModel().findByIdAndViewer(op.pageId, ctx.requester);
    if (page == null) {
      return { status: 'failed', reason: 'target-unavailable' };
    }
    // renamePage moves the page from wherever it is now, not from the path the proposal was made for.
    if (page.path !== op.fromPath) {
      return {
        status: 'failed',
        reason:
          op.removeRedirectsFrom == null
            ? 'target-unavailable'
            : 'moved-after-apply',
      };
    }
    if (
      !isMovableSourcePath(page.path) ||
      (await findUserPageWriteRefusal({
        existingPath: page.path,
        newPath: op.toPath,
      })) != null
    ) {
      return { status: 'failed', reason: 'target-unavailable' };
    }
    if (await isPathOccupied(op.toPath)) {
      return { status: 'failed', reason: 'path-occupied' };
    }

    try {
      await crowi.pageService.renamePage(
        page,
        op.toPath,
        ctx.requester,
        {
          isRecursively: page.descendantCount > 0,
          createRedirectPage: op.removeRedirectsFrom == null,
          updateMetadata: true,
          isInAppNotificationSuppressed: !ctx.perPageNotifications,
        },
        ctx.activityParameters,
      );
    } catch (err) {
      // renamePage refuses both only with plain Error messages; move.integ.ts
      // drives the real grant refusal through this classification.
      if (await isPathOccupied(op.toPath)) {
        return { status: 'failed', reason: 'path-occupied' };
      }
      if (classifyCreateError(err) === 'grant-not-assignable') {
        return { status: 'failed', reason: 'grant-not-assignable' };
      }
      throw err;
    }
    await removeRedirectsLeftByOriginalMove(op);
    return appliedMove(op);
  },

  async sendPerPageNotifications(op, outcome, ctx) {
    try {
      const page = await pageModel().findById(outcome.resultPageId);
      if (page == null) {
        return;
      }
      await firePageGlobalNotification(
        crowi,
        GlobalNotificationSettingEvent.PAGE_MOVE,
        page,
        ctx.requester,
        { oldPath: op.fromPath },
      );
    } catch (err) {
      logger.error(
        { err, proposalId: ctx.proposalId, operationKey: ctx.operationKey },
        'Failed to send per-page notifications for an applied move',
      );
    }
  },
});
