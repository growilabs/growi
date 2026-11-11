import type { HydratedDocument } from 'mongoose';

import type Crowi from '~/server/crowi';
import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting/consts';
import type { PageDocument } from '~/server/models/page';
import { firePageGlobalNotification } from '~/server/service/page-save';
import loggerFactory from '~/utils/logger';

import { createCanDeletePageCompletely } from '../page-delete-permission';
import { latestRevisionIdOf, pageModel } from './page-model';
import type {
  AppliedOutcome,
  OperationHandler,
  OperationOutcome,
  OperationRecordOf,
} from './types';

const logger = loggerFactory(
  'growi:features:change-proposal:operation-handlers:delete-completely',
);

type DeleteCompletelyOperation = OperationRecordOf<'delete-completely'>;

const appliedDeletion = (op: DeleteCompletelyOperation): AppliedOutcome => ({
  status: 'applied',
  resultPageId: op.pageId,
  resultRevisionId: null,
});

export const createDeleteCompletelyHandler = (
  crowi: Crowi,
): OperationHandler<DeleteCompletelyOperation> => {
  // The page cannot be read back after the deletion, but the delete route
  // notifies with it, so execute keeps it for sendPerPageNotifications.
  const deletedPages = new WeakMap<
    DeleteCompletelyOperation,
    HydratedDocument<PageDocument>
  >();

  return {
    // A page that no longer exists cannot tell this deletion from anyone else's.
    async findExistingResult(op) {
      const exists = await pageModel().exists({ _id: op.pageId });
      return exists == null ? appliedDeletion(op) : null;
    },

    async execute(op, ctx): Promise<OperationOutcome> {
      const Page = pageModel();
      const page = await Page.findByIdAndViewer(op.pageId, ctx.requester);
      if (page == null) {
        return { status: 'failed', reason: 'target-unavailable' };
      }
      // Same order as judgeRevertability. With a child, even an empty one,
      // deleteCompletely would leave an empty page behind.
      if ((await Page.exists({ parent: page._id })) != null) {
        return { status: 'failed', reason: 'has-children' };
      }
      if (latestRevisionIdOf(page) !== op.expectedRevisionId) {
        return { status: 'failed', reason: 'edited-after-apply' };
      }
      const canDeletePageCompletely = await createCanDeletePageCompletely(
        crowi,
        ctx.requester,
      );
      if (!(await canDeletePageCompletely(page))) {
        return { status: 'failed', reason: 'not-deletable' };
      }

      await crowi.pageService.deleteCompletely(
        page,
        ctx.requester,
        { isInAppNotificationSuppressed: !ctx.perPageNotifications },
        false,
        false,
        ctx.activityParameters,
      );
      if (ctx.perPageNotifications) {
        deletedPages.set(op, page);
      }
      return appliedDeletion(op);
    },

    async sendPerPageNotifications(op, _outcome, ctx) {
      const page = deletedPages.get(op);
      deletedPages.delete(op);
      if (page == null) {
        return;
      }
      try {
        await firePageGlobalNotification(
          crowi,
          GlobalNotificationSettingEvent.PAGE_DELETE,
          page,
          ctx.requester,
        );
      } catch (err) {
        logger.error(
          { err, proposalId: ctx.proposalId, operationKey: ctx.operationKey },
          'Failed to send per-page notifications for an applied complete deletion',
        );
      }
    },
  };
};
