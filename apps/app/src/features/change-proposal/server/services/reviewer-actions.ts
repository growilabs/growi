import { randomUUID } from 'node:crypto';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type {
  ApplyResult,
  ApproveResponse,
  ChangeProposalDocument,
  ReviewChannel,
} from '../../interfaces';
import { buildApproveResponse, keysApprovedBy } from './approve-response';
import { selectDecisionTargets } from './decision-targets';
import { recordProposalActivity } from './proposal-activity';
import type { ProposalApplier } from './proposal-applier';
import type { ReviewNotifier } from './review-notifier';
import {
  createReviewRecordActions,
  type ReviewRecordActions,
} from './review-record-actions';
import {
  authorizeReviewerAction,
  fail,
  type ReviewActor,
  type ReviewerActionContext,
  type ReviewerActionResult,
} from './reviewer-action-auth';

export {
  authorizeReviewerAction,
  type ReviewActor,
  type ReviewerActionError,
  type ReviewerActionName,
  type ReviewerActionResult,
} from './reviewer-action-auth';

const logger = loggerFactory(
  'growi:features:change-proposal:services:reviewer-actions',
);

export type ReviewerActions = ReviewRecordActions & {
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
    ...createReviewRecordActions({ crowi, reviewNotifier, now }),
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
