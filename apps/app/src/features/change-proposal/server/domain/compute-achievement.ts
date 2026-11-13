import type {
  OperationRecord,
  ProposalAchievement,
  ProposalEntry,
} from '../../interfaces';
import { APPLIED_AT_LEAST_ONCE_STATUSES } from '../../interfaces';

export const computeAchievement = (
  entry: ProposalEntry,
  operations: readonly Pick<OperationRecord, 'status' | 'reason'>[],
): ProposalAchievement | undefined => {
  // A revert proposal's stale/failed operations are shown as "revert-refused" on the original operation.
  if (entry === 'revert') {
    return undefined;
  }

  const applied = operations.filter((o) =>
    APPLIED_AT_LEAST_ONCE_STATUSES.includes(o.status),
  ).length;
  const skippedByRequester = operations.filter(
    (o) => o.status === 'skipped' && o.reason === 'skipped-by-requester',
  ).length;

  return { applied, attempted: operations.length - skippedByRequester };
};
