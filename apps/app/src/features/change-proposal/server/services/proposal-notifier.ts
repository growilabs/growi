import type { IUserHasId } from '@growi/core';
import mongoose from 'mongoose';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import { InAppNotificationStatuses } from '~/interfaces/in-app-notification';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import Subscription from '~/server/models/subscription';
import { UserStatus } from '~/server/models/user/conts';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  ChangeProposalNotificationSnapshot,
} from '../../interfaces';
import { selectNotifiedPageIds } from '../domain';
import { pageModel } from './operation-handlers/page-model';

const logger = loggerFactory(
  'growi:features:change-proposal:services:proposal-notifier',
);

export type NotifyAppliedArgs = {
  readonly proposal: ChangeProposalDocument;
  readonly activityId: string;
  readonly action:
    | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY
    | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT;
};

export type ProposalNotifier = {
  // Never throws: a failure is only logged and does not change the apply result.
  notifyApplied(args: NotifyAppliedArgs): Promise<void>;
};

type NotificationInput = {
  readonly user: string;
  readonly snapshot: ChangeProposalNotificationSnapshot;
};

const userModel = () => mongoose.model<IUserHasId>('User');

const findRecipientIds = async (
  proposal: ChangeProposalDocument,
  pageIds: readonly string[],
): Promise<string[]> => {
  const subscribers = await Promise.all(
    pageIds.map((pageId) => Subscription.getSubscription(pageId)),
  );
  const candidates = new Set(subscribers.flat().map(String));
  if (proposal.entry === 'revert' && proposal.revertOf != null) {
    const original = await prisma.changeproposals.findProposal(
      proposal.revertOf,
    );
    if (original != null) {
      candidates.add(original.requester);
    }
  }
  candidates.delete(proposal.requester);
  return [...candidates];
};

const buildNotificationInputs = async (
  proposal: ChangeProposalDocument,
  action: NotifyAppliedArgs['action'],
  pageIds: readonly string[],
  recipientIds: readonly string[],
): Promise<NotificationInput[]> => {
  const User = userModel();
  const [recipients, requester] = await Promise.all([
    User.find({
      _id: { $in: recipientIds },
      status: UserStatus.STATUS_ACTIVE,
    }),
    User.findById(proposal.requester, { username: 1 }),
  ]);
  const base = {
    proposalId: proposal._id,
    entry: proposal.entry,
    kind:
      action === SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT
        ? 'revert'
        : 'apply',
    requester: {
      id: proposal.requester,
      username: requester?.username ?? '',
    },
  } as const;

  const Page = pageModel();
  const perRecipient = await Promise.all(
    recipients.map(async (recipient): Promise<NotificationInput | null> => {
      // Pages only people with the link can view are left out (requirement 7.3).
      const viewable = await Page.findByIdsAndViewer(
        [...pageIds],
        recipient,
        null,
        false,
        false,
      );
      if (viewable.length === 0) {
        return null;
      }
      return {
        user: recipient._id.toString(),
        snapshot: {
          ...base,
          pages: viewable.map((page) => ({
            id: page._id.toString(),
            path: page.path,
          })),
        },
      };
    }),
  );
  return perRecipient.filter((input) => input != null);
};

export const createProposalNotifier = (crowi: Crowi): ProposalNotifier => ({
  async notifyApplied({ proposal, activityId, action }) {
    try {
      const pageIds = selectNotifiedPageIds(proposal);
      if (pageIds.length === 0) {
        return;
      }
      const recipientIds = await findRecipientIds(proposal, pageIds);
      if (recipientIds.length === 0) {
        return;
      }
      const inputs = await buildNotificationInputs(
        proposal,
        action,
        pageIds,
        recipientIds,
      );
      if (inputs.length === 0) {
        return;
      }

      // One document per recipient, since each carries its own snapshot.
      const createdAt = new Date();
      await InAppNotification.insertMany(
        inputs.map(({ user, snapshot }) => ({
          user,
          targetModel: SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
          target: proposal._id,
          action,
          status: InAppNotificationStatuses.STATUS_UNOPENED,
          createdAt,
          snapshot: JSON.stringify(snapshot),
          activities: [activityId],
        })),
        { ordered: false },
      );
      await crowi.inAppNotificationService.emitSocketIo(
        inputs.map(({ user }) => user),
      );
    } catch (err) {
      logger.error(
        { err, proposalId: proposal._id },
        'Failed to create the aggregated change proposal notification',
      );
    }
  },
});
