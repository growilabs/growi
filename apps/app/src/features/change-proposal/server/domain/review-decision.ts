import type { OperationRecord, OperationStatus } from '../../interfaces';

export type ApproveVerdict =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      readonly currentStatus: OperationStatus;
      readonly awaitingApply?: boolean;
    };

// An operation that is pending but already approved is waiting for its apply to finish
// (another request holds the lease, or an interrupted apply awaits resumption), so a
// repeated approval must not write again.
export const canApprove = (
  op: Pick<OperationRecord, 'status' | 'approvedAt'>,
): ApproveVerdict => {
  if (op.status !== 'pending') {
    return { accepted: false, currentStatus: op.status };
  }
  if (op.approvedAt != null) {
    return {
      accepted: false,
      currentStatus: op.status,
      awaitingApply: true,
    };
  }
  return { accepted: true };
};
