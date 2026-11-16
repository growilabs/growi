import type {
  OperationRecord,
  OperationView,
  ProposalLinkView,
  Revertability,
  ViewerRole,
} from '../../interfaces';
import type {
  OperationDecisionViews,
  ReviewTargetValues,
} from './review-views';

export type OperationViewExtras = {
  readonly role: ViewerRole;
  readonly page?: { readonly id: string; readonly path: string };
  readonly revertability?: Revertability;
  readonly linkedProposals?: readonly ProposalLinkView[];
  // Set by the caller only for a reviewer's decision target.
  readonly reviewTarget?: ReviewTargetValues;
  readonly decisions?: OperationDecisionViews;
};

const typeSpecificFields = (
  op: OperationRecord,
  showsBody: boolean,
): Partial<OperationView> => {
  switch (op.type) {
    case 'edit':
      return {
        baseRevisionId: op.baseRevisionId,
        ...(showsBody ? { proposedBody: op.body } : {}),
      };
    case 'create':
      return {
        path: op.path,
        ...(showsBody ? { proposedBody: op.body } : {}),
      };
    case 'move':
      return { fromPath: op.fromPath, toPath: op.toPath };
    case 'delete-completely':
      return {};
  }
};

// The requester's order is the stored index; a reviewer's is a rank among what
// they see, given on decision targets only (Reviewers Req 5.2).
const participantFields = (
  op: OperationRecord,
  { role, reviewTarget, decisions }: OperationViewExtras,
): Partial<OperationView> => {
  if (role === 'other') {
    return {};
  }
  const reviewerValues =
    role === 'reviewer' && reviewTarget != null
      ? {
          order: reviewTarget.order,
          ...(reviewTarget.baseIsLatest == null
            ? {}
            : { baseIsLatest: reviewTarget.baseIsLatest }),
        }
      : {};
  return {
    ...(role === 'requester' ? { index: op.index, order: op.index } : {}),
    ...reviewerValues,
    ...decisions,
  };
};

/**
 * Shapes one already-selected operation for the response. The order index goes
 * to the requester only, since a gap in indices would reveal hidden operations;
 * the proposed body goes to the requester and to a reviewer deciding it.
 */
export const toOperationView = (
  op: OperationRecord,
  extras: OperationViewExtras,
): OperationView => {
  const { role, page, revertability, linkedProposals } = extras;
  const showsBody =
    role === 'requester' ||
    (role === 'reviewer' && extras.reviewTarget != null);
  return {
    key: op.key,
    type: op.type,
    status: op.status,
    ...(op.reason == null ? {} : { reason: op.reason }),
    ...(op.appliedAt == null ? {} : { appliedAt: op.appliedAt.toISOString() }),
    ...(page == null ? {} : { page }),
    ...typeSpecificFields(op, showsBody),
    ...(op.resultRevisionId == null
      ? {}
      : { resultRevisionId: op.resultRevisionId }),
    ...(op.revertedByProposalId == null
      ? {}
      : { revertedByProposalId: op.revertedByProposalId }),
    ...(op.revertTarget == null ? {} : { revertTarget: op.revertTarget }),
    ...(revertability == null ? {} : { revertability }),
    ...(linkedProposals == null || linkedProposals.length === 0
      ? {}
      : { linkedProposals }),
    ...participantFields(op, extras),
  };
};
