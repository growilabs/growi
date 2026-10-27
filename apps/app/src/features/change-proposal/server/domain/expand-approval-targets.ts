import type { OperationRecord } from '../../interfaces';

export const expandApprovalTargets = (
  _operations: readonly OperationRecord[],
  _chosenIndices: readonly number[] | 'all',
): readonly number[] => {
  throw new Error('Not implemented');
};
