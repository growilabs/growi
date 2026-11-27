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
import { collectCreatedPaths, selectNotifiedPageIds } from '../domain';
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

type NotifiedPage = ChangeProposalNotificationSnapshot['pages'][number];

// The original proposal a revert proposal reverts, or null for any other proposal.
const findOriginal = (
  proposal: ChangeProposalDocument,
): Promise<ChangeProposalDocument | null> =>
  proposal.entry === 'revert' && proposal.revertOf != null
    ? prisma.changeproposals.findProposal(proposal.revertOf)
    : Promise.resolve(null);

// Pages a revert deleted completely, named by the path the original requester
// asked to create. No viewer check can read a deleted page, so only that requester,
// who already sees the create in the original proposal, is told about them.
const findDeletedCreatedPages = (
  proposal: ChangeProposalDocument,
  original: ChangeProposalDocument | null,
): NotifiedPage[] => {
  if (original == null) {
    return [];
  }
  const createdPaths = collectCreatedPaths(original.operations);
  return proposal.operations.flatMap((op) => {
    if (op.type !== 'delete-completely' || op.status !== 'applied') {
      return [];
    }
    const path =
      op.revertTarget == null
        ? undefined
        : createdPaths.get(op.revertTarget.operationKey);
    return path == null ? [] : [{ id: op.pageId, path }];
  });
};

const userModel = () => mongoose.model<IUserHasId>('User');

const findRecipientIds = async (
  proposal: ChangeProposalDocument,
  original: ChangeProposalDocument | null,
  pageIds: readonly string[],
): Promise<string[]> => {
  const subscribers = await Promise.all(
    pageIds.map((pageId) => Subscription.getSubscription(pageId)),
  );
  const candidates = new Set(subscribers.flat().map(String));
  if (original != null) {
    candidates.add(original.requester);
  }
  candidates.delete(proposal.requester);
  return [...candidates];
};

const buildNotificationInputs = async ({
  proposal,
  original,
  action,
  pageIds,
  recipientIds,
}: {
  readonly proposal: ChangeProposalDocument;
  readonly original: ChangeProposalDocument | null;
  readonly action: NotifyAppliedArgs['action'];
  readonly pageIds: readonly string[];
  readonly recipientIds: readonly string[];
}): Promise<NotificationInput[]> => {
  const deletedCreatedPages = findDeletedCreatedPages(proposal, original);
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
      const isOriginalRequester =
        original != null && recipient._id.toString() === original.requester;
      const pages: NotifiedPage[] = [
        ...viewable.map((page) => ({
          id: page._id.toString(),
          path: page.path,
        })),
        ...(isOriginalRequester ? deletedCreatedPages : []),
      ];
      if (pages.length === 0) {
        return null;
      }
      // The original requester is pointed at the original, where every operation
      // they asked for is recorded together with whether it was reverted.
      const linked = isOriginalRequester
        ? { proposalId: original._id, entry: original.entry }
        : {};
      return {
        user: recipient._id.toString(),
        snapshot: { ...base, ...linked, pages },
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
      const original = await findOriginal(proposal);
      const recipientIds = await findRecipientIds(proposal, original, pageIds);
      if (recipientIds.length === 0) {
        return;
      }
      const inputs = await buildNotificationInputs({
        proposal,
        original,
        action,
        pageIds,
        recipientIds,
      });
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
