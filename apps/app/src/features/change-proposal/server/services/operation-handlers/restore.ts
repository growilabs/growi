import { isTrashPage } from '@growi/core/dist/utils/page-path-utils';

import type Crowi from '~/server/crowi';
import { PathAlreadyExistsError } from '~/server/models/errors';
import { prisma } from '~/utils/prisma';

import { latestRevisionIdOf, pageModel } from './page-model';
import type {
  AppliedOutcome,
  OperationHandler,
  OperationOutcome,
  OperationRecordOf,
} from './types';

type RestoreOperation = OperationRecordOf<'restore'>;

const appliedRestore = (op: RestoreOperation): AppliedOutcome => ({
  status: 'applied',
  resultPageId: op.pageId,
  resultRevisionId: null,
});

// Trashing left a redirect from the original path to the trash path, and a
// non-recursive revertDeletedPage does not remove it; redirects are resolved
// before pages, so it would keep hiding the restored page.
const removeRedirectLeftByTrash = async (
  op: RestoreOperation,
): Promise<void> => {
  await prisma.pageredirects.deleteByFromPath(op.toPath);
};

export const createRestoreHandler = (
  crowi: Crowi,
): OperationHandler<RestoreOperation> => ({
  // The redirect removal is idempotent, so a run stopped between the restore
  // and the removal is finished here.
  async findExistingResult(op) {
    const page = await pageModel().findById(op.pageId, { path: 1 });
    if (page == null || page.path !== op.toPath || isTrashPage(page.path)) {
      return null;
    }
    await removeRedirectLeftByTrash(op);
    return appliedRestore(op);
  },

  async execute(op, ctx): Promise<OperationOutcome> {
    const page = await pageModel().findByIdAndViewer(op.pageId, ctx.requester);
    if (page == null) {
      return { status: 'failed', reason: 'target-unavailable' };
    }
    if (!isTrashPage(page.path)) {
      return { status: 'failed', reason: 'not-in-trash' };
    }
    if (latestRevisionIdOf(page) !== op.expectedRevisionId) {
      return { status: 'failed', reason: 'edited-after-apply' };
    }

    try {
      // Only pages without children are trashed by a proposal, so never recursive.
      await crowi.pageService.revertDeletedPage(
        page,
        ctx.requester,
        { isInAppNotificationSuppressed: !ctx.perPageNotifications },
        false,
        ctx.activityParameters,
      );
    } catch (err) {
      if (err instanceof PathAlreadyExistsError) {
        return { status: 'failed', reason: 'original-path-occupied' };
      }
      throw err;
    }
    await removeRedirectLeftByTrash(op);
    return appliedRestore(op);
  },

  // Restoring from the trash has no global notification, for humans either.
  async sendPerPageNotifications() {},
});
