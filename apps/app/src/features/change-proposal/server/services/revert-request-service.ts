import type { IUserHasId } from '@growi/core';
import mongoose from 'mongoose';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import { InAppNotificationStatuses } from '~/interfaces/in-app-notification';
import { InAppNotification } from '~/server/models/in-app-notification';
import { UserStatus } from '~/server/models/user/conts';
import { prisma } from '~/utils/prisma';

import {
  type ChangeProposalRevertRequestSnapshot,
  REVERT_REQUEST_COOLDOWN_MS,
} from '../../interfaces';
import type { GetChangeProposalService } from '../routes/read-access';

export type RevertRequestError =
  | { readonly code: 'not-found' }
  | { readonly code: 'own-proposal' }
  | { readonly code: 'requester-unavailable' }
  | { readonly code: 'recently-requested' };

export type SendRevertRequestArgs = {
  readonly getService: GetChangeProposalService;
  readonly proposalId: string;
  readonly sender: IUserHasId;
  readonly message: string;
  readonly activityId: string;
  readonly now: Date;
};

export type SendRevertRequestResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: RevertRequestError };

export type RevertRequestServiceDeps = {
  readonly emitNotificationUpdated: (
    userIds: readonly string[],
  ) => Promise<void>;
};

export type RevertRequestService = {
  sendRevertRequest(
    args: SendRevertRequestArgs,
  ): Promise<SendRevertRequestResult>;
};

const refuse = (code: RevertRequestError['code']): SendRevertRequestResult => ({
  ok: false,
  error: { code },
});

const isActiveUser = async (userId: string): Promise<boolean> =>
  (await mongoose
    .model<IUserHasId>('User')
    .exists({ _id: userId, status: UserStatus.STATUS_ACTIVE })) != null;

// Refused attempts settle as ACTION_UNSETTLED, so only sent requests count.
const hasRecentRequest = async (
  senderId: string,
  proposalId: string,
  now: Date,
): Promise<boolean> =>
  (await prisma.activities.findFirst({
    where: {
      userId: senderId,
      target: proposalId,
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST,
      createdAt: { gt: new Date(now.getTime() - REVERT_REQUEST_COOLDOWN_MS) },
    },
    select: { id: true },
  })) != null;

export const createRevertRequestService = (
  deps: RevertRequestServiceDeps,
): RevertRequestService => ({
  async sendRevertRequest({
    getService,
    proposalId,
    sender,
    message,
    activityId,
    now,
  }) {
    // Nothing is read from the view's operations (requirement 4.8).
    const found = await getService().getForViewer(proposalId, sender);
    if (!found.ok) {
      return refuse('not-found');
    }
    const { id, isRequester, requester } = found.value;
    if (isRequester) {
      return refuse('own-proposal');
    }
    if (!(await isActiveUser(requester.id))) {
      return refuse('requester-unavailable');
    }
    const senderId = sender._id.toString();
    if (await hasRecentRequest(senderId, id, now)) {
      return refuse('recently-requested');
    }

    const snapshot: ChangeProposalRevertRequestSnapshot = {
      proposalId: id,
      kind: 'revert-request',
      sender: { id: senderId, username: sender.username },
      message,
    };
    // A single insert, not upsertByActivity, which merges similar notifications.
    await InAppNotification.create({
      user: requester.id,
      targetModel: SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
      target: id,
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST,
      status: InAppNotificationStatuses.STATUS_UNOPENED,
      createdAt: now,
      snapshot: JSON.stringify(snapshot),
      activities: [activityId],
    });
    await deps.emitNotificationUpdated([requester.id]);
    return { ok: true };
  },
});
