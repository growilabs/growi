import type {
  OperationRecord,
  ProposalLifecycle,
  ProposalStatus,
} from '../../interfaces';
import { APPLIED_AT_LEAST_ONCE_STATUSES } from '../../interfaces';

export const deriveProposalStatus = (
  lifecycle: ProposalLifecycle,
  operations: readonly Pick<OperationRecord, 'status'>[],
): ProposalStatus => {
  if (lifecycle === 'open' && operations.some((o) => o.status === 'pending')) {
    return 'pending';
  }

  const touched = operations.filter((o) =>
    APPLIED_AT_LEAST_ONCE_STATUSES.includes(o.status),
  );
  if (touched.length === 0) {
    return lifecycle === 'discarded' ||
      lifecycle === 'expired' ||
      lifecycle === 'withdrawn'
      ? lifecycle
      : 'not-applied';
  }

  const revertedCount = touched.filter((o) => o.status === 'reverted').length;
  if (revertedCount === touched.length) {
    return 'reverted';
  }
  if (revertedCount > 0) {
    return 'partially-reverted';
  }

  const hasUnappliedOutcome = operations.some(
    (o) =>
      o.status === 'failed' || o.status === 'stale' || o.status === 'skipped',
  );
  return hasUnappliedOutcome ? 'partially-applied' : 'applied';
};
