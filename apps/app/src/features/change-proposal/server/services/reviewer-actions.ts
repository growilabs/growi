import { randomUUID } from 'node:crypto';
import type { IUserHasId } from '@growi/core';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type {
  ApplyResult,
  ApplyTrigger,
  ApproveResponse,
  ChangeProposalDocument,
  ReviewChannel,
} from '../../interfaces';
import { deriveViewerRole, type ViewerIdentity } from '../domain';
import { buildApproveResponse, keysApprovedBy } from './approve-response';
import { selectDecisionTargets } from './decision-targets';
import { isRequesterAllowed } from './pre-write-checks';
import { recordProposalActivity } from './proposal-activity';
import type { ProposalApplier } from './proposal-applier';
import type { ReviewNotifier } from './review-notifier';
import {
  type ReviewScopeResult,
  resolveReviewScope,
} from './review-scope-resolver';
import { loadViewerIdentity } from './reviewer-identity';

const logger = loggerFactory(
  'growi:features:change-proposal:services:reviewer-actions',
);

export type ReviewActor = {
  readonly user: IUserHasId;
  readonly channel: ReviewChannel;
  readonly trigger: ApplyTrigger;
};

export type ReviewerActionError =
  | 'not-found'
  | 'not-open'
  | 'comment-too-long'
  | 'reviewer-not-found'
  | 'too-many-reviewers'
  | 'requester-cannot-review'
  | 'reviewers-disabled'
  | 'invalid-request'
  | 'user-not-allowed';

export type ReviewerActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: { readonly code: ReviewerActionError };
    };

export type ReviewerActionName =
  | 'approve'
  | 'rejectOperations'
  | 'rejectAll'
  | 'abstain'
  | 'addReviewers'
  | 'removeReviewers';

export type ReviewerActionContext = {
  readonly proposal: ChangeProposalDocument;
  readonly identity: ViewerIdentity;
  readonly role: 'requester' | 'reviewer';
  readonly scope: ReviewScopeResult;
};

// Reviews are a reviewer's opinion; the requester skips or discards instead (Reviewers Req 3.10).
const REVIEWER_ONLY_ACTIONS: ReadonlySet<ReviewerActionName> = new Set([
  'rejectOperations',
  'rejectAll',
  'abstain',
]);

const fail = (
  code: ReviewerActionError,
): {
  readonly ok: false;
  readonly error: { readonly code: ReviewerActionError };
} => ({
  ok: false,
  error: { code },
});

// The requester knows the whole proposal; anyone else is answered from the stage
// their visible operations imply (see design.md, reviewer-actions step 3).
const isOpenTo = ({ role, proposal, scope }: ReviewerActionContext): boolean =>
  role === 'requester'
    ? proposal.lifecycle === 'open'
    : scope.visibleStage === 'open';

/**
 * The steps all six reviewer actions share, in this order: who may act at all,
 * then whether they see anything, and only then whether the proposal is still
 * open — so a caller who sees nothing gets the missing-proposal answer even for
 * a closed proposal (Reviewers Req 2.7, 3.11).
 */
export const authorizeReviewerAction = async (
  proposalId: string,
  actor: ReviewActor,
  action: ReviewerActionName,
): Promise<ReviewerActionResult<ReviewerActionContext>> => {
  // writeAccessChain refuses these on the routes; an AI tool calls the service directly.
  if (!isRequesterAllowed(actor.user)) {
    return fail('user-not-allowed');
  }
  const [proposal, identity] = await Promise.all([
    prisma.changeproposals.findProposal(proposalId),
    loadViewerIdentity(actor.user._id.toString()),
  ]);
  if (proposal == null) {
    return fail('not-found');
  }
  const role = deriveViewerRole(
    proposal.requester,
    proposal.reviewers,
    identity,
  );
  if (role === 'other') {
    return fail('not-found');
  }
  const scope = await resolveReviewScope(proposal.operations, identity, role);
  if (role !== 'requester' && scope.visibleKeys.size === 0) {
    return fail('not-found');
  }
  if (role === 'requester' && REVIEWER_ONLY_ACTIONS.has(action)) {
    return fail('requester-cannot-review');
  }
  const context = { proposal, identity, role, scope };
  return isOpenTo(context) ? { ok: true, value: context } : fail('not-open');
};

export type ReviewerActions = {
  // The one way to approve, for the requester and the reviewers alike; omitted
  // keys approve everything the caller may decide.
  approve(
    proposalId: string,
    actor: ReviewActor,
    operationKeys?: readonly string[],
  ): Promise<ReviewerActionResult<ApproveResponse>>;
};

export type ReviewerActionsDeps = {
  readonly crowi: Crowi;
  readonly applier: ProposalApplier;
  readonly reviewNotifier: ReviewNotifier;
  readonly now: () => Date;
};

export const createReviewerActions = (
  deps: ReviewerActionsDeps,
): ReviewerActions => {
  const { crowi, applier, reviewNotifier, now } = deps;

  // `accepted`: the approval write went through, whether or not another request had
  // already approved the targets. `approvedKeys`: what this request wrote, read back by its token.
  const writeApproval = async (
    { proposal, identity }: ReviewerActionContext,
    channel: ReviewChannel,
    targetKeys: readonly string[],
  ): Promise<
    ReviewerActionResult<{
      readonly accepted: boolean;
      readonly approvedKeys: readonly string[];
    }>
  > => {
    const decisionToken = randomUUID();
    const approved = await prisma.changeproposals.markApproved(
      proposal._id,
      { approver: identity, channel, decisionToken },
      targetKeys,
      now(),
    );
    const reread = await prisma.changeproposals.findProposal(proposal._id);
    // A write conflict also answers not-open; while the proposal is open it only means nothing was written.
    if (
      !approved.ok &&
      (approved.code === 'not-found' || reread?.lifecycle !== 'open')
    ) {
      return fail(approved.code);
    }
    return {
      ok: true,
      value: {
        accepted: approved.ok,
        approvedKeys: keysApprovedBy(reread?.operations ?? [], decisionToken),
      },
    };
  };

  // Reject and abstain records only inform, so a failed cleanup must not fail the approval.
  const clearReviews = async (
    { proposal, identity }: ReviewerActionContext,
    targetKeys: readonly string[],
    wholeProposal: boolean,
  ): Promise<void> => {
    try {
      await prisma.changeproposals.clearReviewsOnApproval(
        proposal._id,
        identity.userId,
        targetKeys,
        { wholeProposal },
      );
    } catch (err) {
      logger.error(
        { err, proposalId: proposal._id },
        'Failed to clear the approver’s reviews of the approved operations',
      );
    }
  };

  const recordApproval = (
    proposalId: string,
    actor: ReviewActor,
    approvedKeys: readonly string[],
  ): string | null =>
    approvedKeys.length === 0
      ? null
      : recordProposalActivity(crowi, {
          action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPROVE,
          proposalId,
          operator: actor.user,
          trigger: actor.trigger,
          channel: actor.channel,
        }).activityId;

  const runApply = async (proposalId: string): Promise<ApplyResult> => {
    try {
      // The background form records the apply as the requester on its own activity,
      // without the approver's ip and endpoint (see design.md, proposal-activity).
      return await applier.apply(proposalId, { kind: 'background' });
    } catch (err) {
      // The approvals are saved, so the maintenance cron resumes the apply.
      logger.error({ err, proposalId }, 'Applying approved operations failed');
      return { type: 'in-progress' };
    }
  };

  // Read after the apply, so a created page the requester cannot see stays out of the notice.
  const readAndNotify = async (
    proposalId: string,
    actor: ReviewActor,
    activityId: string | null,
    approvedKeys: readonly string[],
  ): Promise<ChangeProposalDocument | null> => {
    const after = await prisma.changeproposals.findProposal(proposalId);
    if (activityId != null && after != null) {
      await reviewNotifier.notifyReviewResult({
        proposal: after,
        reviewer: actor.user,
        activityId,
        decision: {
          kind: 'operations',
          result: 'approved',
          operationKeys: approvedKeys,
        },
      });
    }
    return after;
  };

  return {
    async approve(proposalId, actor, operationKeys) {
      const authorized = await authorizeReviewerAction(
        proposalId,
        actor,
        'approve',
      );
      if (!authorized.ok) {
        return authorized;
      }
      const context = authorized.value;
      const { proposal } = context;
      const { requestedKeys, targetKeys } = selectDecisionTargets(
        proposal.operations,
        context.scope,
        operationKeys ?? 'all',
      );
      // Keys pulled in from the same page are reported too: this request decided them.
      const reportedKeys = new Set([...requestedKeys, ...targetKeys]);
      if (targetKeys.length === 0) {
        const value = buildApproveResponse(
          proposal.operations,
          reportedKeys,
          null,
        );
        return { ok: true, value };
      }

      const approved = await writeApproval(context, actor.channel, targetKeys);
      if (!approved.ok) {
        return approved;
      }
      const { accepted, approvedKeys } = approved.value;
      const activityId = recordApproval(proposal._id, actor, approvedKeys);
      if (accepted) {
        await clearReviews(context, targetKeys, operationKeys == null);
      }
      const applied = await runApply(proposal._id);
      const after = await readAndNotify(
        proposal._id,
        actor,
        activityId,
        approvedKeys,
      );
      const value = buildApproveResponse(
        after?.operations ?? [],
        reportedKeys,
        applied,
      );
      return { ok: true, value };
    },
  };
};
