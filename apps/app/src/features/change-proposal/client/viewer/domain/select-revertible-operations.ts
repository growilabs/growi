import type { OperationView } from '../../../interfaces';

export const selectRevertibleOperations = (
  _operations: readonly OperationView[],
): readonly OperationView[] => {
  throw new Error('Not implemented');
};
