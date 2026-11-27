import type { OperationView, ProposalAchievement } from '../../interfaces';
import { BASED_ON_ELIGIBLE_STATUSES } from '../../interfaces';

export const toAchievementPercent = (
  achievement: ProposalAchievement,
): number | null => {
  if (achievement.attempted === 0) {
    return null;
  }
  return Math.floor((achievement.applied * 100) / achievement.attempted);
};

// Excludes 'pending' (still approvable) and the operations the requester skipped on purpose.
export const selectRemainingOperations = (
  operations: readonly OperationView[],
): readonly OperationView[] =>
  operations.filter(
    (operation) =>
      BASED_ON_ELIGIBLE_STATUSES['follow-up'].includes(operation.status) &&
      operation.reason !== 'skipped-by-requester',
  );
