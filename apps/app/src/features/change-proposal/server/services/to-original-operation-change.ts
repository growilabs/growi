import type { OperationReason, RevertRefusalReason } from '../../interfaces';
import type {
  OriginalOperationChange,
  RecordedOutcome,
} from '../models/change-proposal-types';

// A Record, so adding a RevertRefusalReason without listing it here fails type-checking.
const REVERT_REFUSAL_REASONS: Readonly<Record<RevertRefusalReason, true>> = {
  'not-revertible-state': true,
  'target-unavailable': true,
  'edited-after-apply': true,
  'has-children': true,
  'moved-after-apply': true,
  'original-path-occupied': true,
  'page-operation-in-progress': true,
  'not-deletable': true,
  'apply-failed': true,
};

const isRevertRefusalReason = (
  reason: OperationReason,
): reason is RevertRefusalReason =>
  Object.hasOwn(REVERT_REFUSAL_REASONS, reason);

// Why the original operation is refused when its revert operation ended stale or
// failed (design "取り消しの流れ" table).
export const toRevertRefusalReason = (outcome: {
  readonly status: 'stale' | 'failed';
  readonly reason?: OperationReason;
}): RevertRefusalReason => {
  if (outcome.status === 'stale') {
    return 'edited-after-apply';
  }
  if (outcome.reason != null && isRevertRefusalReason(outcome.reason)) {
    return outcome.reason;
  }
  return outcome.reason === 'path-occupied'
    ? 'original-path-occupied'
    : 'apply-failed';
};

// Maps a revert operation's recorded outcome onto the original operation. null
// leaves the original as it is: a skipped revert keeps it applied so the revert
// can be requested again.
export const toOriginalOperationChange = (
  outcome: RecordedOutcome,
  revertProposalId: string,
  now: Date,
): OriginalOperationChange | null => {
  switch (outcome.status) {
    case 'applied':
      return {
        status: 'reverted',
        revertedByProposalId: revertProposalId,
        revertedAt: now,
      };
    case 'stale':
    case 'failed':
      return {
        status: 'revert-refused',
        reason: toRevertRefusalReason(outcome),
      };
    case 'skipped':
    case 'pending':
      return null;
  }
};
