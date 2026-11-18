import type { DecisionResponse, OperationRecord } from '../../interfaces';

// Reports the reported keys only, as read after the write, in operation order.
export const buildDecisionResponse = (
  operations: readonly OperationRecord[],
  reportedKeys: ReadonlySet<string>,
): DecisionResponse => ({
  type: 'done',
  results: operations
    .filter((op) => reportedKeys.has(op.key))
    .map((op) => ({
      key: op.key,
      status: op.status,
      reason: op.reason ?? null,
    })),
});
