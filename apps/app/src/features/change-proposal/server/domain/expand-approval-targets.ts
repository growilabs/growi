import type { OperationRecord } from '../../interfaces';

// A create has no page yet, so its path stands in for the page identity.
const pageKeyOf = (op: OperationRecord): string =>
  op.type === 'create' ? `path:${op.path}` : `page:${op.pageId}`;

export const expandApprovalTargets = (
  operations: readonly OperationRecord[],
  chosenIndices: readonly number[] | 'all',
): readonly number[] => {
  const pending = operations.filter((op) => op.status === 'pending');
  if (chosenIndices === 'all') {
    return pending.map((op) => op.index);
  }
  const chosen = new Set(chosenIndices);
  const pageKeys = new Set(
    operations.filter((op) => chosen.has(op.index)).map(pageKeyOf),
  );
  return pending
    .filter((op) => pageKeys.has(pageKeyOf(op)))
    .map((op) => op.index);
};
