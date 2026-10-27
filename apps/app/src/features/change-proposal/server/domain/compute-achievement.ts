import type {
  OperationRecord,
  ProposalAchievement,
  ProposalEntry,
} from '../../interfaces';

export const computeAchievement = (
  _entry: ProposalEntry,
  _operations: readonly Pick<OperationRecord, 'status' | 'reason'>[],
): ProposalAchievement | undefined => {
  throw new Error('Not implemented');
};
