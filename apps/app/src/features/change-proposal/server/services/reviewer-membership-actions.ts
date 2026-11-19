import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { prisma } from '~/utils/prisma';

import {
  MAX_REVIEWERS,
  type ReviewerInput,
  type ReviewerRef,
} from '../../interfaces';
import {
  activeReviewers,
  dedupeReviewerInputs,
  hasForeignReviewer,
} from '../domain';
import { allReviewersExist } from './create-reviewers';
import { recordProposalActivity } from './proposal-activity';
import type { ReviewNotifier } from './review-notifier';
import {
  authorizeReviewerAction,
  fail,
  type ReviewActor,
  type ReviewerActionContext,
  type ReviewerActionResult,
} from './reviewer-action-auth';
import { readChangeProposalSettings } from './settings';

export type ReviewerMembershipActions = {
  addReviewers(
    proposalId: string,
    actor: ReviewActor,
    inputs: readonly ReviewerInput[],
  ): Promise<ReviewerActionResult<void>>;
  removeReviewers(
    proposalId: string,
    actor: ReviewActor,
    inputs: readonly ReviewerInput[],
  ): Promise<ReviewerActionResult<void>>;
};

export type ReviewerMembershipActionsDeps = {
  readonly crowi: Crowi;
  readonly reviewNotifier: ReviewNotifier;
  readonly now: () => Date;
};

const DONE: ReviewerActionResult<void> = { ok: true, value: undefined };

const isNamedIn = (
  reviewers: readonly ReviewerRef[],
  input: ReviewerInput,
): boolean => reviewers.some((r) => r.kind === input.kind && r.id === input.id);

// Only the reviewers this request would add count: the switch stops storing new
// ones, and the limit adds them to the active ones (Req 18.6, 18.9).
const selectNewReviewers = async (
  { proposal, identity }: ReviewerActionContext,
  given: readonly ReviewerInput[],
  now: Date,
): Promise<ReviewerActionResult<readonly ReviewerInput[]>> => {
  const active = activeReviewers(proposal.reviewers);
  const fresh = given.filter((input) => !isNamedIn(active, input));
  const asAdded = fresh.map((input) => ({
    ...input,
    addedBy: identity.userId,
    addedAt: now,
  }));
  if (
    !readChangeProposalSettings().isReviewersEnabled &&
    hasForeignReviewer(asAdded, proposal.requester)
  ) {
    return fail('reviewers-disabled');
  }
  if (active.length + fresh.length > MAX_REVIEWERS) {
    return fail('too-many-reviewers');
  }
  if (fresh.length > 0 && !(await allReviewersExist(fresh))) {
    return fail('reviewer-not-found');
  }
  return { ok: true, value: fresh };
};

export const createReviewerMembershipActions = (
  deps: ReviewerMembershipActionsDeps,
): ReviewerMembershipActions => {
  const { crowi, reviewNotifier, now } = deps;

  // The notifier keeps only active reviewers of the proposal it is given, so it gets the one read after the write.
  const announceAddition = async (
    { proposal, identity }: ReviewerActionContext,
    actor: ReviewActor,
    added: readonly ReviewerInput[],
  ): Promise<void> => {
    const { activityId } = recordProposalActivity(crowi, {
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEWER_ADD,
      proposalId: proposal._id,
      operator: actor.user,
      trigger: actor.trigger,
      channel: actor.channel,
    });
    const after = await prisma.changeproposals.findProposal(proposal._id);
    if (after != null) {
      await reviewNotifier.notifyReviewRequest({
        proposal: after,
        candidates: added,
        actorId: identity.userId,
        activityId,
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEWER_ADD,
      });
    }
  };

  return {
    // A write that gives up partway throws like a reject does, so the reviewers
    // stored before it get neither the activity nor the notice.
    async addReviewers(proposalId, actor, inputs) {
      const given = dedupeReviewerInputs(inputs);
      const authorized = await authorizeReviewerAction(
        proposalId,
        actor,
        'addReviewers',
      );
      if (!authorized.ok) {
        return authorized;
      }
      const context = authorized.value;
      const addedAt = now();
      const fresh = await selectNewReviewers(context, given, addedAt);
      if (!fresh.ok || fresh.value.length === 0) {
        return fresh.ok ? DONE : fresh;
      }
      const written = await prisma.changeproposals.addReviewers(
        context.proposal._id,
        context.identity,
        fresh.value,
        addedAt,
      );
      if (!written.ok) {
        return fail(written.code);
      }
      if (written.added.length > 0) {
        await announceAddition(context, actor, written.added);
      }
      return DONE;
    },

    async removeReviewers(proposalId, actor, inputs) {
      const given = dedupeReviewerInputs(inputs);
      const authorized = await authorizeReviewerAction(
        proposalId,
        actor,
        'removeReviewers',
      );
      if (!authorized.ok) {
        return authorized;
      }
      const { proposal, identity } = authorized.value;
      const active = activeReviewers(proposal.reviewers);
      const named = given.filter((input) => isNamedIn(active, input));
      // Naming no reviewer removes nothing, so there is nothing to record (Req 18.7).
      if (named.length === 0) {
        return DONE;
      }
      const written = await prisma.changeproposals.removeReviewers(
        proposal._id,
        identity,
        named,
        now(),
      );
      if (!written.ok) {
        return fail(written.code);
      }
      recordProposalActivity(crowi, {
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEWER_REMOVE,
        proposalId: proposal._id,
        operator: actor.user,
        trigger: actor.trigger,
        channel: actor.channel,
      });
      return DONE;
    },
  };
};
