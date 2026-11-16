import type { OperationReason, OperationStatus } from './change-proposal';

export const MAX_REVIEWERS = 20;
export const MAX_REVIEW_COMMENT_LENGTH = 500;
export const MAX_PURPOSE_LENGTH = 2000;

export type ReviewerKind = 'user' | 'user-group' | 'external-user-group';
export type ReviewChannel = 'ui' | 'api' | 'ai-tool';
export type ReviewKind = 'reject' | 'abstain';
export type ViewerRole = 'requester' | 'reviewer' | 'other';

export type ReviewerInput = {
  readonly kind: ReviewerKind;
  readonly id: string;
};

export type ReviewerRef = ReviewerInput & {
  readonly addedBy: string;
  readonly addedAt: Date;
  // A removed reviewer stays in the array as a record; a set removedAt means "not a reviewer".
  readonly removedBy?: string;
  readonly removedAt?: Date;
};

// An empty operationKey is a rejection of the whole proposal.
export type ReviewRecord = {
  readonly kind: ReviewKind;
  readonly operationKey?: string;
  readonly by: string;
  readonly at: Date;
  readonly comment?: string;
  readonly channel: ReviewChannel;
};

export type UserSummary = {
  readonly id: string;
  readonly username: string;
  readonly name: string;
};

export type ReviewerView = ReviewerInput & {
  // User name for a user, group name for a group.
  readonly name: string;
  readonly addedBy: UserSummary;
  readonly addedAt: string;
  readonly removedBy?: UserSummary;
  readonly removedAt?: string;
};

export type ReviewDecisionView = {
  readonly by: UserSummary;
  readonly at: string;
  readonly comment?: string;
};

export type ApprovalView = {
  readonly by: UserSummary;
  readonly at: string;
  readonly channel: ReviewChannel;
};

export type DecisionResponse = {
  readonly type: 'done';
  readonly results: readonly {
    readonly key: string;
    readonly status: OperationStatus;
    readonly reason: OperationReason | null;
  }[];
};
