import { getIdStringForRef } from '@growi/core';
import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';
import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting/consts';
import type { PageDocument, PageModel } from '~/server/models/page';
import { firePageGlobalNotification } from '~/server/service/page-save';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import { toRevisionProposalMark } from '../../domain';
import { classifyCreateError } from './classify-create-error';
import type {
  OperationHandler,
  OperationOutcome,
  OperationRecordOf,
} from './types';

const logger = loggerFactory(
  'growi:features:change-proposal:operation-handlers:create',
);

type CreateOperation = OperationRecordOf<'create'>;

const pageModel = (): PageModel =>
  mongoose.model<PageDocument, PageModel>('Page');

// An empty page only holds the tree together, so it does not occupy the path.
const isPathOccupied = async (path: string): Promise<boolean> =>
  (await pageModel().exists({ path, isEmpty: false })) != null;

export const createCreateHandler = (
  crowi: Crowi,
): OperationHandler<CreateOperation> => ({
  // pageService.create writes the first revision unconditionally, so a marked
  // revision always belongs to the page this operation created.
  async findExistingResult(op, ctx) {
    const marked = await prisma.revisions.findFirst({
      where: { proposalId: ctx.proposalId, proposalOperationKey: op.key },
      select: { id: true, pageId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (marked == null) {
      return null;
    }
    return {
      status: 'applied',
      resultPageId: marked.pageId,
      resultRevisionId: marked.id,
    };
  },

  async execute(op, ctx): Promise<OperationOutcome> {
    const Page = pageModel();
    const ancestor = await Page.findNonEmptyClosestAncestor(op.path);
    if (
      ancestor != null &&
      (await Page.findByIdAndViewer(ancestor._id, ctx.requester)) == null
    ) {
      return { status: 'failed', reason: 'target-unavailable' };
    }
    if (await isPathOccupied(op.path)) {
      return { status: 'failed', reason: 'path-occupied' };
    }

    try {
      // No grant and no wip: the page inherits the ancestor's grant (design OQ-4).
      const page = await crowi.pageService.create(
        op.path,
        op.body,
        ctx.requester,
        {
          proposalMark: toRevisionProposalMark({
            proposalId: ctx.proposalId,
            operationKey: op.key,
          }),
        },
      );
      return {
        status: 'applied',
        resultPageId: page._id.toString(),
        resultRevisionId:
          page.revision == null ? null : getIdStringForRef(page.revision),
      };
    } catch (err) {
      const kind = classifyCreateError(err);
      if (kind === 'grant-not-assignable') {
        return { status: 'failed', reason: 'grant-not-assignable' };
      }
      // canProcessCreate refuses without saying why; a page created since the check is the one case we can name.
      if (kind === 'not-processable' && (await isPathOccupied(op.path))) {
        return { status: 'failed', reason: 'path-occupied' };
      }
      throw err;
    }
  },

  async sendPerPageNotifications(_op, outcome, ctx) {
    try {
      const page = await pageModel().findById(outcome.resultPageId);
      if (page == null) {
        return;
      }
      await firePageGlobalNotification(
        crowi,
        GlobalNotificationSettingEvent.PAGE_CREATE,
        page,
        ctx.requester,
      );
    } catch (err) {
      logger.error(
        { err, proposalId: ctx.proposalId, operationKey: ctx.operationKey },
        'Failed to send per-page notifications for an applied create',
      );
    }
  },
});
