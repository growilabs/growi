import type { OperationView } from '../../../interfaces';

export const selectRevertibleOperations = (
  operations: readonly OperationView[],
): readonly OperationView[] =>
  operations.filter(
    (operation) => operation.revertability?.revertible === true,
  );
