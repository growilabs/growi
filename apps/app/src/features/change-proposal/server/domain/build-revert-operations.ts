import type { OperationRecord, RevertOperationInput } from '../../interfaces';

export type RevertibleOperationFacts = {
  readonly key: string;
  readonly originalBody?: string;
  readonly restoreToPath?: string;
};

export const buildRevertOperations = (
  _target: {
    readonly proposalId: string;
    readonly operations: readonly OperationRecord[];
  },
  _revertible: readonly RevertibleOperationFacts[],
): readonly RevertOperationInput[] => {
  throw new Error('Not implemented');
};
