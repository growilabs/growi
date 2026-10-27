import { isTrashPage } from '@growi/core/dist/utils/page-path-utils';

import type Crowi from '~/server/crowi';
import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting/consts';
import { firePageGlobalNotification } from '~/server/service/page-save';
import loggerFactory from '~/utils/logger';

import { canTrashPage } from '../page-delete-permission';
import { latestRevisionIdOf, pageModel } from './page-model';
import type {
  AppliedOutcome,
  OperationHandler,
  OperationOutcome,
  OperationRecordOf,
} from './types';

const logger = loggerFactory(
  'growi:features:change-proposal:operation-handlers:trash',
);

type TrashOperation = OperationRecordOf<'trash'>;

const appliedTrash = (op: TrashOperation): AppliedOutcome => ({
  status: 'applied',
  resultPageId: op.pageId,
  resultRevisionId: null,
});

export const createTrashHandler = (
  crowi: Crowi,
): OperationHandler<TrashOperation> => ({
  // Being in the trash cannot tell this proposal's trash from anyone else's.
  async findExistingResult(op) {
    const page = await pageModel().findById(op.pageId, { path: 1 });
    if (page == null || !isTrashPage(page.path)) {
      return null;
    }
    return appliedTrash(op);
  },

  async execute(op, ctx): Promise<OperationOutcome> {
    const Page = pageModel();
    const page = await Page.findByIdAndViewer(op.pageId, ctx.requester);
    if (page == null) {
      return { status: 'failed', reason: 'target-unavailable' };
    }
    // Same order as judgeRevertability. A child, even an empty one, would make
    // deletePage leave an empty page behind instead of removing the path.
    if ((await Page.exists({ parent: page._id })) != null) {
      return { status: 'failed', reason: 'has-children' };
    }
    if (latestRevisionIdOf(page) !== op.expectedRevisionId) {
      return { status: 'failed', reason: 'edited-after-apply' };
    }
    if (!(await canTrashPage(crowi.pageService, page, ctx.requester))) {
      return { status: 'failed', reason: 'not-deletable' };
    }

    await crowi.pageService.deletePage(
      page,
      ctx.requester,
      { isInAppNotificationSuppressed: !ctx.perPageNotifications },
      false,
      ctx.activityParameters,
    );
    return appliedTrash(op);
  },

  async sendPerPageNotifications(_op, outcome, ctx) {
    try {
      const Page = pageModel();
      const trashed = await Page.findById(outcome.resultPageId);
      if (trashed == null) {
        return;
      }
      // The delete route notifies with the page as it was before trashing;
      // settings are matched against that path, never the /trash one.
      const beforeTrash = Page.hydrate({
        ...trashed.toObject(),
        path: Page.getRevertDeletedPageName(trashed.path),
      });
      await firePageGlobalNotification(
        crowi,
        GlobalNotificationSettingEvent.PAGE_DELETE,
        beforeTrash,
        ctx.requester,
      );
    } catch (err) {
      logger.error(
        { err, proposalId: ctx.proposalId, operationKey: ctx.operationKey },
        'Failed to send per-page notifications for an applied trash',
      );
    }
  },
});
