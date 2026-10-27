import type { FailureReason, RevertRefusalReason } from '../../interfaces';
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
  'not-in-trash': true,
  'page-operation-in-progress': true,
  'apply-failed': true,
};

const isRevertRefusalReason = (
  reason: FailureReason,
): reason is RevertRefusalReason =>
  Object.hasOwn(REVERT_REFUSAL_REASONS, reason);

const toRefusalReason = (reason: FailureReason): RevertRefusalReason => {
  if (isRevertRefusalReason(reason)) {
    return reason;
  }
  return reason === 'path-occupied' ? 'original-path-occupied' : 'apply-failed';
};

// Maps a revert operation's recorded outcome onto the original operation (design
// "取り消しの流れ" table). null leaves the original as it is: a skipped revert
// keeps it applied so the revert can be requested again.
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
      return { status: 'revert-refused', reason: 'edited-after-apply' };
    case 'failed':
      return {
        status: 'revert-refused',
        reason: toRefusalReason(outcome.reason),
      };
    case 'skipped':
    case 'pending':
      return null;
  }
};
