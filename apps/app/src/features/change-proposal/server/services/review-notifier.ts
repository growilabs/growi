import type { IUserHasId } from '@growi/core';
import mongoose from 'mongoose';

import {
  type SupportedAction,
  SupportedTargetModel,
} from '~/interfaces/activity';
import { InAppNotificationStatuses } from '~/interfaces/in-app-notification';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import { UserStatus } from '~/server/models/user/conts';
import loggerFactory from '~/utils/logger';

import type {
  ChangeProposalDocument,
  ReviewerInput,
  ReviewRequestNotificationSnapshot,
  ReviewResultNotificationSnapshot,
  ViewerRole,
} from '../../interfaces';
import { deriveViewerRole } from '../domain';
import type { ViewablePages } from './current-page-facts';
import {
  buildReviewRequestPages,
  buildReviewResultContent,
  type ReviewDecisionNotice,
  type ReviewRequestPage,
  selectReviewRequestRecipientIds,
} from './review-notification-content';
import {
  type ReviewScopeResult,
  resolveReviewScopesWithPages,
} from './review-scope-resolver';
import { loadViewerIdentity } from './reviewer-identity';

export type { ReviewDecisionNotice } from './review-notification-content';

const logger = loggerFactory(
  'growi:features:change-proposal:services:review-notifier',
);

export type NotifyReviewRequestArgs = {
  // Read after the reviewers were stored.
  readonly proposal: ChangeProposalDocument;
  // The reviewers this request made active: AddReviewersResult.added, or the
  // proposal's reviewers when it is created.
  readonly candidates: readonly ReviewerInput[];
  // Who added them; the requester when the proposal is created.
  readonly actorId: string;
  readonly activityId: string;
  // The triggering activity's action. The snapshot kind, not this, tells the
  // notification apart (research.md: notification action Decision).
  readonly action:
    | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_CREATE
    | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEWER_ADD;
};

export type NotifyReviewResultArgs = {
  // Read after the decision was written.
  readonly proposal: ChangeProposalDocument;
  readonly reviewer: IUserHasId;
  readonly activityId: string;
  // A whole rejection is recorded as REJECT.
  readonly action:
    | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_APPROVE
    | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_REJECT
    | typeof SupportedAction.ACTION_CHANGE_PROPOSAL_ABSTAIN;
  readonly decision: ReviewDecisionNotice;
};

export type ReviewNotifier = {
  // Neither throws: a failure is only logged and does not change the result of
  // the write that triggered it.
  notifyReviewRequest(args: NotifyReviewRequestArgs): Promise<void>;
  notifyReviewResult(args: NotifyReviewResultArgs): Promise<void>;
};

const userModel = () => mongoose.model<IUserHasId>('User');

const toPagePaths = (viewable: ViewablePages): ReadonlyMap<string, string> =>
  new Map([...viewable.pages].map(([id, page]) => [id, page.path]));

// The proposal as this user sees it, with its role read from the stored
// reviewers and the user's groups at this moment (Reviewers Req 5.9).
const resolveFor = async (
  proposal: ChangeProposalDocument,
  userId: string,
  expectedRole: ViewerRole,
): Promise<{
  readonly scope: ReviewScopeResult;
  readonly pagePaths: ReadonlyMap<string, string>;
} | null> => {
  const identity = await loadViewerIdentity(userId);
  const role = deriveViewerRole(
    proposal.requester,
    proposal.reviewers,
    identity,
  );
  if (role !== expectedRole) {
    return null;
  }
  const { scopes, viewable } = await resolveReviewScopesWithPages(
    [{ operations: proposal.operations, role }],
    identity,
    [],
  );
  return { scope: scopes[0], pagePaths: toPagePaths(viewable) };
};

// Reviewers Req 6.3, 6.4: only the pages this reviewer may decide, and nothing
// at all when there is none.
const pagesForReviewer = async (
  proposal: ChangeProposalDocument,
  userId: string,
): Promise<readonly ReviewRequestPage[]> => {
  const resolved = await resolveFor(proposal, userId, 'reviewer');
  return resolved == null
    ? []
    : buildReviewRequestPages(
        proposal.operations,
        resolved.scope.reviewTargetKeys,
        resolved.pagePaths,
      );
};

const findActiveUsers = async (
  ids: readonly string[],
): Promise<readonly string[]> => {
  const found = await userModel()
    .find({ _id: { $in: ids }, status: UserStatus.STATUS_ACTIVE }, { _id: 1 })
    .lean()
    .exec();
  return found.map((u) => String(u._id));
};

const buildReviewRequestInputs = async ({
  proposal,
  candidates,
  actorId,
}: NotifyReviewRequestArgs): Promise<
  readonly { user: string; snapshot: ReviewRequestNotificationSnapshot }[]
> => {
  const recipientIds = await findActiveUsers(
    selectReviewRequestRecipientIds(candidates, proposal.requester, actorId),
  );
  if (recipientIds.length === 0) {
    return [];
  }
  const requester = await userModel().findById(proposal.requester, {
    username: 1,
  });
  const perRecipient = await Promise.all(
    recipientIds.map(async (user) => ({
      user,
      pages: await pagesForReviewer(proposal, user),
    })),
  );
  return perRecipient
    .filter(({ pages }) => pages.length > 0)
    .map(({ user, pages }) => ({
      user,
      snapshot: {
        kind: 'review-request',
        proposalId: proposal._id,
        requester: {
          id: proposal.requester,
          username: requester?.username ?? '',
        },
        pages,
      },
    }));
};

// Items come from the requester's own view of the proposal, so an operation
// on a page the requester can no longer view stays out (Reviewers Req 6.5).
const buildReviewResultSnapshot = async ({
  proposal,
  reviewer,
  decision,
}: NotifyReviewResultArgs): Promise<ReviewResultNotificationSnapshot | null> => {
  const resolved = await resolveFor(proposal, proposal.requester, 'requester');
  const content =
    resolved == null
      ? null
      : buildReviewResultContent(
          proposal.operations,
          decision,
          resolved.scope.visibleKeys,
          resolved.pagePaths,
        );
  return content == null
    ? null
    : {
        kind: 'review-result',
        proposalId: proposal._id,
        reviewer: { id: reviewer._id.toString(), username: reviewer.username },
        ...content,
      };
};

const notificationFields = ({
  proposal,
  activityId,
  action,
}: NotifyReviewRequestArgs | NotifyReviewResultArgs) => ({
  targetModel: SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
  target: proposal._id,
  action,
  status: InAppNotificationStatuses.STATUS_UNOPENED,
  // Lets the notification list name who decided or added.
  activities: [activityId],
});

export const createReviewNotifier = (crowi: Crowi): ReviewNotifier => ({
  async notifyReviewRequest(args) {
    try {
      const inputs = await buildReviewRequestInputs(args);
      if (inputs.length === 0) {
        return;
      }
      const createdAt = new Date();
      await InAppNotification.insertMany(
        inputs.map(({ user, snapshot }) => ({
          ...notificationFields(args),
          user,
          createdAt,
          snapshot: JSON.stringify(snapshot),
        })),
        { ordered: false },
      );
      await crowi.inAppNotificationService.emitSocketIo(
        inputs.map(({ user }) => user),
      );
    } catch (err) {
      logger.error(
        { err, proposalId: args.proposal._id },
        'Failed to create the change proposal review request notification',
      );
    }
  },

  async notifyReviewResult(args) {
    // Reviewers Req 6.6: the requester's own decision is not reported back.
    if (args.reviewer._id.toString() === args.proposal.requester) {
      return;
    }
    try {
      const snapshot = await buildReviewResultSnapshot(args);
      if (snapshot == null) {
        return;
      }
      await InAppNotification.create({
        ...notificationFields(args),
        user: args.proposal.requester,
        createdAt: new Date(),
        snapshot: JSON.stringify(snapshot),
      });
      await crowi.inAppNotificationService.emitSocketIo([
        args.proposal.requester,
      ]);
    } catch (err) {
      logger.error(
        { err, proposalId: args.proposal._id },
        'Failed to create the change proposal review result notification',
      );
    }
  },
});
