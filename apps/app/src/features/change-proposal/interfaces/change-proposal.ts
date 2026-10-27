// Total size cap for the bodies in one proposal; keeps a document well under MongoDB's 16 MB limit.
export const MAX_TOTAL_BODY_BYTES = 8 * 1024 * 1024;

export type ProposalEntry = 'ai-chat' | 'vault' | 'mcp' | 'revert';
export type CreatableEntry = Exclude<ProposalEntry, 'revert'>;
export type CreatableOperationType = 'edit' | 'create' | 'move';
// trash / restore exist only in revert proposals
export type OperationType = CreatableOperationType | 'trash' | 'restore';
export type ProposalLifecycle =
  | 'open'
  | 'settled'
  | 'discarded'
  | 'expired'
  | 'withdrawn';
export type OperationStatus =
  | 'pending'
  | 'applied'
  | 'failed'
  | 'stale'
  | 'skipped'
  | 'reverted'
  | 'revert-refused';
export type ProposalStatus =
  | 'pending'
  | 'applied'
  | 'partially-applied'
  | 'reverted'
  | 'partially-reverted'
  | 'not-applied'
  | 'discarded'
  | 'expired'
  | 'withdrawn';
export type AutoApplyPolicy = 'none' | 'own-pages' | 'all';

export type WaitingReason = 'page-being-edited' | 'page-operation-in-progress';
export type RevertRefusalReason =
  | 'not-revertible-state'
  | 'target-unavailable'
  | 'edited-after-apply'
  | 'has-children'
  | 'moved-after-apply'
  | 'original-path-occupied'
  | 'not-in-trash'
  | 'page-operation-in-progress'
  | 'apply-failed';
export type FailureReason =
  | 'target-unavailable'
  | 'path-occupied'
  | 'grant-not-assignable'
  | 'feature-disabled'
  | 'operation-type-disabled'
  | 'requester-not-allowed'
  | 'write-error'
  | RevertRefusalReason;
export type StaleReason = 'base-revision-changed';
export type SkipReason =
  | 'skipped-by-requester'
  | 'discarded'
  | 'expired'
  | 'withdrawn'
  | 'page-being-edited';
export type OperationReason =
  | WaitingReason
  | FailureReason
  | StaleReason
  | SkipReason;
export type Revertability =
  | { readonly revertible: true }
  | { readonly revertible: false; readonly reason: RevertRefusalReason };

export type BasedOnRelation = 'follow-up' | 'rework';
export type BasedOn = {
  readonly proposalId: string;
  readonly relation: BasedOnRelation;
  readonly operationKeys: readonly string[];
};
export const BASED_ON_ELIGIBLE_STATUSES: {
  readonly [K in BasedOnRelation]: readonly OperationStatus[];
} = {
  'follow-up': ['stale', 'failed', 'skipped'],
  rework: ['applied', 'revert-refused'],
};
export const APPLIED_AT_LEAST_ONCE_STATUSES: readonly OperationStatus[] = [
  'applied',
  'reverted',
  'revert-refused',
];
export type ProposalAchievement = {
  readonly applied: number;
  readonly attempted: number;
};

// Carries the operation key, never the order index, so a revision cannot reveal hidden operations.
export type ProposalMark = {
  readonly proposalId: string;
  readonly operationKey: string;
};

export type OperationPayload =
  | {
      readonly type: 'edit';
      readonly pageId: string;
      readonly baseRevisionId: string;
      readonly body: string;
    }
  | { readonly type: 'create'; readonly path: string; readonly body: string }
  | {
      readonly type: 'move';
      readonly pageId: string;
      readonly fromPath: string;
      readonly toPath: string;
      readonly removeRedirectsFrom?: string;
    }
  | {
      readonly type: 'trash';
      readonly pageId: string;
      readonly expectedRevisionId: string;
    }
  | {
      readonly type: 'restore';
      readonly pageId: string;
      readonly expectedRevisionId: string;
      readonly toPath: string;
    };

export type CreatableOperationInput = Extract<
  OperationPayload,
  { type: CreatableOperationType }
>;
// A revert never creates a page: a create is reversed by a trash.
export type RevertOperationInput = Exclude<
  OperationPayload,
  { type: 'create' }
> & {
  readonly revertTarget: ProposalMark;
};

export type OperationRecord = OperationPayload & {
  readonly index: number;
  readonly key: string;
  readonly status: OperationStatus;
  readonly reason?: OperationReason;
  readonly approvedAt?: Date;
  readonly appliedAt?: Date;
  readonly resultPageId?: string;
  readonly resultRevisionId?: string;
  readonly revertTarget?: ProposalMark;
  readonly revertedByProposalId?: string;
  readonly revertedAt?: Date;
};

export type ChangeProposalDocument = {
  readonly _id: string;
  readonly requester: string;
  readonly entry: ProposalEntry;
  readonly modelLabel?: string;
  readonly revertOf?: string;
  readonly basedOn?: BasedOn;
  readonly lifecycle: ProposalLifecycle;
  readonly operations: readonly OperationRecord[];
  readonly appliedPageIds: readonly string[];
  readonly lastAppliedAt?: Date;
  readonly applyLease?: {
    readonly token: string;
    readonly expiresAt: Date;
  } | null;
  readonly expiresAt?: Date;
  readonly perPageNotifications: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
