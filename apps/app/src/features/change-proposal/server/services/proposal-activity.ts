import type { IUserHasId } from '@growi/core';

import {
  type ChangeProposalReviewSnapshot,
  type SupportedAction,
  SupportedTargetModel,
} from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import {
  beginActivity,
  pendingActivityContext,
} from '~/server/service/activity/index';
import loggerFactory from '~/utils/logger';

import type { ApplyTrigger, ReviewChannel } from '../../interfaces';

const logger = loggerFactory(
  'growi:features:change-proposal:services:proposal-activity',
);

type ProposalLifecycleAction =
  | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_CREATE
  | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY
  | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT;

export type ProposalReviewAction =
  | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_APPROVE
  | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_REJECT
  | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_ABSTAIN
  | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEWER_ADD
  | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEWER_REMOVE;

export type ChangeProposalAction =
  | ProposalLifecycleAction
  | ProposalReviewAction;

export type RecordProposalActivityArgs = {
  readonly proposalId: string;
  readonly operator: IUserHasId;
  readonly trigger: ApplyTrigger;
  readonly request?: { readonly ip?: string; readonly endpoint?: string };
} & (
  | { readonly action: ProposalLifecycleAction; readonly channel?: never }
  | { readonly action: ProposalReviewAction; readonly channel: ReviewChannel }
);

const toReviewSnapshot = (
  channel: ReviewChannel,
): ChangeProposalReviewSnapshot => ({
  // username is left to the settle step, which takes it from the operator's
  // stashed context.
  reviewChannel: channel,
});

/**
 * Records the activity synchronously: on the request path it must run before the
 * response is sent (see apps/app/.claude/rules/activity-recording.md).
 * Returns the activity id so the aggregated notification can reference it.
 */
export const recordProposalActivity = (
  crowi: Crowi,
  {
    action,
    proposalId,
    operator,
    trigger,
    request,
    channel,
  }: RecordProposalActivityArgs,
): { activityId: string } => {
  const ownsContext = trigger.kind === 'background';
  const { activityId } =
    trigger.kind === 'request'
      ? { activityId: trigger.activityId }
      : beginActivity({
          ip: request?.ip,
          endpoint: request?.endpoint,
          userId: operator._id.toString(),
          username: operator.username,
          createdAt: new Date(),
        });

  try {
    // No target document: the per-page in-app notification path must stay idle
    // (the aggregated notification is ProposalNotifier's job).
    crowi.events.activity.emit('update', activityId, {
      action,
      targetModel: SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
      target: proposalId,
      ...(channel == null ? {} : { snapshot: toReviewSnapshot(channel) }),
    });
  } catch (err) {
    logger.error(
      { err, proposalId, action },
      'Failed to record the change proposal activity',
    );
    if (ownsContext) {
      pendingActivityContext.clear(activityId);
    }
  }
  return { activityId };
};
