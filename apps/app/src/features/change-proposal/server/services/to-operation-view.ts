import type {
  OperationRecord,
  OperationView,
  ProposalLinkView,
  Revertability,
} from '../../interfaces';

export type OperationViewExtras = {
  readonly isRequester: boolean;
  readonly page?: { readonly id: string; readonly path: string };
  readonly revertability?: Revertability;
  readonly linkedProposals?: readonly ProposalLinkView[];
};

const typeSpecificFields = (
  op: OperationRecord,
  isRequester: boolean,
): Partial<OperationView> => {
  switch (op.type) {
    case 'edit':
      return {
        baseRevisionId: op.baseRevisionId,
        ...(isRequester ? { proposedBody: op.body } : {}),
      };
    case 'create':
      return {
        path: op.path,
        ...(isRequester ? { proposedBody: op.body } : {}),
      };
    case 'move':
      return { fromPath: op.fromPath, toPath: op.toPath };
    case 'restore':
      return { toPath: op.toPath };
    case 'trash':
      return {};
  }
};

/**
 * Shapes one already-selected operation for the response. The order index and
 * the proposed body go to the requester only: a gap in indices would reveal
 * hidden operations, and a body is the requester's draft.
 */
export const toOperationView = (
  op: OperationRecord,
  extras: OperationViewExtras,
): OperationView => {
  const { isRequester, page, revertability, linkedProposals } = extras;
  return {
    key: op.key,
    ...(isRequester ? { index: op.index } : {}),
    type: op.type,
    status: op.status,
    ...(op.reason == null ? {} : { reason: op.reason }),
    ...(op.appliedAt == null ? {} : { appliedAt: op.appliedAt.toISOString() }),
    ...(page == null ? {} : { page }),
    ...typeSpecificFields(op, isRequester),
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
  };
};
