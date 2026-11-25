import type { OperationRecord } from '../../interfaces';
import { expandApprovalTargets } from '../domain';
import type { ReviewScopeResult } from './review-scope-visibility';

export type DecisionTargets = {
  // Requested keys the viewer sees, decided now or not: what the answer reports.
  readonly requestedKeys: readonly string[];
  // What this request decides.
  readonly targetKeys: readonly string[];
};

const keysOf = (
  operations: readonly OperationRecord[],
  include: (op: OperationRecord) => boolean,
): readonly string[] => operations.filter(include).map((op) => op.key);

/**
 * A hidden key is treated as a missing one (Req 16.6): it neither
 * counts as requested nor pulls in the operations on its page, and a requested
 * key pulls in only the visible operations on its page.
 */
export const selectDecisionTargets = (
  operations: readonly OperationRecord[],
  scope: Pick<ReviewScopeResult, 'visibleKeys' | 'reviewTargetKeys'>,
  operationKeys: readonly string[] | 'all',
): DecisionTargets => {
  const visible = operations.filter((op) => scope.visibleKeys.has(op.key));
  const isTarget = (op: OperationRecord) => scope.reviewTargetKeys.has(op.key);
  if (operationKeys === 'all') {
    const all = keysOf(visible, isTarget);
    return { requestedKeys: all, targetKeys: all };
  }
  const requested = new Set(operationKeys);
  const isRequested = (op: OperationRecord) => requested.has(op.key);
  const expanded = new Set(
    expandApprovalTargets(
      visible,
      visible.filter(isRequested).map((op) => op.index),
    ),
  );
  return {
    requestedKeys: keysOf(visible, isRequested),
    targetKeys: keysOf(visible, (op) => expanded.has(op.index) && isTarget(op)),
  };
};
