import type {
  OperationRecord,
  ProposalLifecycle,
  ProposalStatus,
} from '../../interfaces';

export const deriveProposalStatus = (
  _lifecycle: ProposalLifecycle,
  _operations: readonly Pick<OperationRecord, 'status'>[],
): ProposalStatus => {
  throw new Error('Not implemented');
};
