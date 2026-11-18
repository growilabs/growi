import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { prisma } from '~/utils/prisma';

import {
  type DecisionResponse,
  MAX_REVIEW_COMMENT_LENGTH,
  type ReviewKind,
} from '../../interfaces';
import type {
  ReviewEntry,
  ReviewOperationsTarget,
  ReviewWholeTarget,
} from '../models/change-proposal-types';
import { buildDecisionResponse } from './decision-response';
import { selectDecisionTargets } from './decision-targets';
import { isWithinCodePoints } from './normalize-create-input';
import { recordProposalActivity } from './proposal-activity';
import type { ReviewDecisionNotice, ReviewNotifier } from './review-notifier';
import {
  authorizeReviewerAction,
  fail,
  type ReviewActor,
  type ReviewerActionContext,
  type ReviewerActionName,
  type ReviewerActionResult,
} from './reviewer-action-auth';

// A reject never stops an approval or an apply: like an abstention it is only a
// record and a notice (see research.md's reject-and-abstain Decision).
export type ReviewRecordActions = {
  rejectOperations(
    proposalId: string,
    actor: ReviewActor,
    operationKeys: readonly string[],
    comment?: string,
  ): Promise<ReviewerActionResult<DecisionResponse>>;
  rejectAll(
    proposalId: string,
    actor: ReviewActor,
    comment?: string,
  ): Promise<ReviewerActionResult<DecisionResponse>>;
  abstain(
    proposalId: string,
    actor: ReviewActor,
    operationKeys: readonly string[],
    comment?: string,
  ): Promise<ReviewerActionResult<DecisionResponse>>;
};

export type ReviewRecordActionsDeps = {
  readonly crowi: Crowi;
  readonly reviewNotifier: ReviewNotifier;
  readonly now: () => Date;
};

type ReviewRequest = { readonly comment?: string } & (
  | { readonly kind: ReviewKind; readonly target: ReviewOperationsTarget }
  | { readonly kind: 'reject'; readonly target: ReviewWholeTarget }
);

const toEntry = (
  request: ReviewRequest,
  channel: ReviewEntry['channel'],
): ReviewEntry => ({ ...request, channel });

const ACTIVITY_OF = {
  reject: SupportedAction.ACTION_CHANGE_PROPOSAL_REJECT,
  abstain: SupportedAction.ACTION_CHANGE_PROPOSAL_ABSTAIN,
} as const satisfies Record<ReviewKind, string>;

const NOTICE_RESULT_OF = {
  reject: 'rejected',
  abstain: 'abstained',
} as const satisfies Record<ReviewKind, string>;

const isCommentTooLong = (comment: string | undefined): boolean =>
  comment != null && !isWithinCodePoints(comment, MAX_REVIEW_COMMENT_LENGTH);

const toNotice = (entry: ReviewRequest): ReviewDecisionNotice => {
  const comment = entry.comment == null ? {} : { comment: entry.comment };
  return entry.target.scope === 'whole'
    ? { kind: 'whole-rejection', ...comment }
    : {
        kind: 'operations',
        result: NOTICE_RESULT_OF[entry.kind],
        operationKeys: entry.target.operationKeys,
        ...comment,
      };
};

// What gets recorded (the visible pending operations the keys reach) and what is
// answered (the visible requested keys plus those reached on the same page).
const chooseRecorded = (
  { proposal, scope }: ReviewerActionContext,
  request: ReviewRequest,
): {
  readonly entry: ReviewRequest;
  readonly reported: ReadonlySet<string>;
} => {
  const { target } = request;
  if (target.scope === 'whole') {
    return { entry: request, reported: new Set() };
  }
  const { requestedKeys, targetKeys } = selectDecisionTargets(
    proposal.operations,
    scope,
    target.operationKeys,
  );
  return {
    entry: {
      ...request,
      target: { scope: 'operations', operationKeys: targetKeys },
    },
    reported: new Set([...requestedKeys, ...targetKeys]),
  };
};

export const createReviewRecordActions = (
  deps: ReviewRecordActionsDeps,
): ReviewRecordActions => {
  const { crowi, reviewNotifier, now } = deps;

  // A write that gave up on write conflicts throws: a reject or an abstention leaves
  // every operation as it was, so answering it with the current state would read as recorded.
  const writeRecord = async (
    { proposal, identity }: ReviewerActionContext,
    actor: ReviewActor,
    entry: ReviewRequest,
  ): Promise<ReviewerActionResult<void>> => {
    const result = await prisma.changeproposals.addReviews(
      proposal._id,
      identity,
      toEntry(entry, actor.channel),
      now(),
    );
    return result.ok ? { ok: true, value: undefined } : fail(result.code);
  };

  // Read after the write, as the notice and the answer must show the state it left.
  const announce = async (
    proposalId: string,
    actor: ReviewActor,
    entry: ReviewRequest,
  ) => {
    const { activityId } = recordProposalActivity(crowi, {
      action: ACTIVITY_OF[entry.kind],
      proposalId,
      operator: actor.user,
      trigger: actor.trigger,
      channel: actor.channel,
    });
    const after = await prisma.changeproposals.findProposal(proposalId);
    if (after != null) {
      await reviewNotifier.notifyReviewResult({
        proposal: after,
        reviewer: actor.user,
        activityId,
        action: ACTIVITY_OF[entry.kind],
        decision: toNotice(entry),
      });
    }
    return after;
  };

  const decide = async (
    proposalId: string,
    actor: ReviewActor,
    action: ReviewerActionName,
    given: ReviewRequest,
  ): Promise<ReviewerActionResult<DecisionResponse>> => {
    if (isCommentTooLong(given.comment)) {
      return fail('comment-too-long');
    }
    // An empty comment means no comment, whichever way the action was reached.
    const request: ReviewRequest =
      given.comment === '' ? { ...given, comment: undefined } : given;
    const authorized = await authorizeReviewerAction(proposalId, actor, action);
    if (!authorized.ok) {
      return authorized;
    }
    const context = authorized.value;
    const { proposal } = context;
    const { entry, reported } = chooseRecorded(context, request);
    // Nothing it named is still pending, so there is nothing to record (Req 16.11).
    if (
      entry.target.scope === 'operations' &&
      entry.target.operationKeys.length === 0
    ) {
      return {
        ok: true,
        value: buildDecisionResponse(proposal.operations, reported),
      };
    }
    const written = await writeRecord(context, actor, entry);
    if (!written.ok) {
      return written;
    }
    const after = await announce(proposal._id, actor, entry);
    const operations = (after ?? proposal).operations;
    return { ok: true, value: buildDecisionResponse(operations, reported) };
  };

  return {
    rejectOperations: (proposalId, actor, operationKeys, comment) =>
      decide(proposalId, actor, 'rejectOperations', {
        kind: 'reject',
        target: { scope: 'operations', operationKeys },
        comment,
      }),
    rejectAll: (proposalId, actor, comment) =>
      decide(proposalId, actor, 'rejectAll', {
        kind: 'reject',
        target: { scope: 'whole' },
        comment,
      }),
    abstain: (proposalId, actor, operationKeys, comment) =>
      decide(proposalId, actor, 'abstain', {
        kind: 'abstain',
        target: { scope: 'operations', operationKeys },
        comment,
      }),
  };
};
