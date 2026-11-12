import type { IUserHasId } from '@growi/core';

import type {
  FailureReason,
  OperationRecord,
  OperationType,
  StaleReason,
} from '../../../interfaces';

export type OperationContext = {
  readonly proposalId: string;
  readonly operationKey: string;
  readonly requester: IUserHasId;
  readonly activityParameters: {
    readonly ip?: string;
    readonly endpoint?: string;
  };
  // Result of shouldSendPerPageNotifications for this operation; handlers never read settings.
  readonly perPageNotifications: boolean;
};

// findExistingResult runs before the requester is checked, so it gets no requester.
export type ExistingResultContext = Pick<OperationContext, 'proposalId'>;

export type AppliedOutcome = {
  readonly status: 'applied';
  readonly resultPageId: string;
  readonly resultRevisionId: string | null;
};

export type OperationOutcome =
  | AppliedOutcome
  | { readonly status: 'stale'; readonly reason: StaleReason }
  | { readonly status: 'failed'; readonly reason: FailureReason };

export type OperationRecordOf<K extends OperationType> = Extract<
  OperationRecord,
  { readonly type: K }
>;

// An unexpected exception from findExistingResult or execute is not mapped here;
// ProposalApplier records it as `failed: write-error` (design "Error Strategy").
export interface OperationHandler<T extends OperationRecord> {
  // Detects a write already done by an interrupted run. It may also finish that
  // write's idempotent cleanup (e.g. leftover redirects), so it is not read-only.
  findExistingResult(
    op: T,
    ctx: ExistingResultContext,
  ): Promise<OperationOutcome | null>;
  execute(op: T, ctx: OperationContext): Promise<OperationOutcome>;
  // Called only after the applied outcome is recorded and ctx.perPageNotifications is true; never throws.
  sendPerPageNotifications(
    op: T,
    outcome: AppliedOutcome,
    ctx: OperationContext,
  ): Promise<void>;
}

export type OperationHandlerTable = {
  readonly [K in OperationType]: OperationHandler<OperationRecordOf<K>>;
};
