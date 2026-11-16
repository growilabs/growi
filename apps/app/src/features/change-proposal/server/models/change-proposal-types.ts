import type {
  BasedOn,
  FailureReason,
  OperationPayload,
  OperationStatus,
  OperationType,
  ProposalEntry,
  ProposalMark,
  RevertRefusalReason,
  ReviewChannel,
  ReviewerInput,
  ReviewerRef,
  ReviewKind,
  SkipReason,
  StaleReason,
  WaitingReason,
} from '../../interfaces';
import type { ViewerIdentity } from '../domain';

export type CreateOperationInput = OperationPayload & {
  readonly revertTarget?: ProposalMark;
  readonly approvedAt?: Date;
};

export type CreateProposalInput = {
  readonly requester: string;
  readonly entry: ProposalEntry;
  readonly modelLabel?: string;
  readonly revertOf?: string;
  readonly basedOn?: BasedOn;
  readonly perPageNotifications: boolean;
  readonly purpose?: string;
  readonly reviewers?: readonly ReviewerRef[];
  readonly expiresAt?: Date;
  readonly operations: readonly CreateOperationInput[];
};

export type RequesterWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'not-found' | 'not-open' };

// An approval made by a request, so it records who approved, from where, and which request wrote it.
export type AttributedApproval = {
  readonly approver: ViewerIdentity;
  readonly channel: ReviewChannel;
  readonly decisionToken: string;
};

export type AddReviewersResult =
  | { readonly ok: true; readonly added: readonly ReviewerInput[] }
  | { readonly ok: false; readonly code: 'not-found' | 'not-open' };

// A reject or abstain record on the chosen operations, or a rejection of the whole proposal.
export type ReviewEntry = {
  readonly channel: ReviewChannel;
  readonly comment?: string;
} & (
  | { readonly kind: ReviewKind; readonly operationKeys: readonly string[] }
  | { readonly kind: 'reject'; readonly operationKeys: 'whole-proposal' }
);

export type RecordedOutcome =
  | {
      readonly status: 'applied';
      readonly resultPageId: string;
      readonly resultRevisionId: string | null;
    }
  | { readonly status: 'stale'; readonly reason: StaleReason }
  | { readonly status: 'failed'; readonly reason: FailureReason }
  | {
      readonly status: 'skipped';
      readonly reason: Extract<SkipReason, 'page-being-edited'>;
    }
  // back to waiting: the status stays pending and the approval is withdrawn
  | { readonly status: 'pending'; readonly reason: WaitingReason };

export type OriginalOperationChange =
  | {
      readonly status: 'reverted';
      readonly revertedByProposalId: string;
      readonly revertedAt: Date;
    }
  | { readonly status: 'revert-refused'; readonly reason: RevertRefusalReason };

export type ClosingLifecycle = 'expired' | 'withdrawn';

export type LinkedProposalRecord = {
  readonly id: string;
  readonly requester: string;
  readonly entry: ProposalEntry;
  readonly basedOn: BasedOn;
  readonly operations: readonly {
    readonly key: string;
    readonly type: OperationType;
    readonly status: OperationStatus;
    readonly pageId?: string;
    readonly resultPageId?: string;
  }[];
};

export type AppliedListCursor = {
  readonly lastAppliedAt: Date;
  readonly id: string;
};
