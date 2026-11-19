import type { OperationRecord } from '../../interfaces';

export type VisibleStage =
  | 'open'
  | 'expired'
  | 'discarded'
  | 'withdrawn'
  | 'settled';

const CLOSING_REASONS: readonly VisibleStage[] = [
  'expired',
  'discarded',
  'withdrawn',
];

// The actual lifecycle is deliberately not an input: it would reveal whether operations
// the viewer cannot see are still pending.
export const deriveVisibleStage = (
  visibleOperations: readonly Pick<OperationRecord, 'status' | 'reason'>[],
): VisibleStage => {
  if (visibleOperations.some((op) => op.status === 'pending')) {
    return 'open';
  }
  const closing = visibleOperations
    .filter((op) => op.status === 'skipped')
    .map((op) => CLOSING_REASONS.find((stage) => stage === op.reason))
    .find((stage) => stage != null);
  return closing ?? 'settled';
};
