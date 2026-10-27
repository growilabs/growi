import type { OperationRecord } from '../../interfaces';

export const planApplyOrder = (
  operations: readonly OperationRecord[],
  targetIndices: readonly number[],
): readonly number[] => {
  const targets = new Set(targetIndices);
  const selected = operations.filter((op) => targets.has(op.index));
  // A move changes the path other operations may still address, so it goes last.
  const nonMoves = selected.filter((op) => op.type !== 'move');
  const moves = selected.filter((op) => op.type === 'move');
  return [...nonMoves, ...moves].map((op) => op.index);
};
