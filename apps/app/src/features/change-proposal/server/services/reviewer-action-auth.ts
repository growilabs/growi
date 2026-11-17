import type { IUserHasId } from '@growi/core';

import { prisma } from '~/utils/prisma';

import type {
  ApplyTrigger,
  ChangeProposalDocument,
  ReviewChannel,
} from '../../interfaces';
import { deriveViewerRole, type ViewerIdentity } from '../domain';
import { isRequesterAllowed } from './pre-write-checks';
import {
  type ReviewScopeResult,
  resolveReviewScope,
} from './review-scope-resolver';
import { loadViewerIdentity } from './reviewer-identity';

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

export const fail = (
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
