import type {
  BasedOn,
  BasedOnRelation,
  OperationReason,
  OperationStatus,
  OperationType,
  ProposalAchievement,
  ProposalEntry,
  ProposalLifecycle,
  ProposalMark,
  ProposalStatus,
  Revertability,
  RevertRefusalReason,
} from './change-proposal';

export type ProposalLinkView = {
  readonly proposalId: string;
  readonly relation: BasedOnRelation;
};

export type OperationView = {
  readonly key: string;
  // Requester only: a gap in indices would reveal hidden operations.
  readonly index?: number;
  readonly type: OperationType;
  readonly status: OperationStatus;
  readonly reason?: OperationReason;
  readonly appliedAt?: string;
  readonly page?: { readonly id: string; readonly path: string };
  readonly path?: string;
  readonly fromPath?: string;
  readonly toPath?: string;
  readonly baseRevisionId?: string;
  readonly resultRevisionId?: string;
  readonly proposedBody?: string;
  readonly revertedByProposalId?: string;
  readonly revertTarget?: ProposalMark;
  readonly revertability?: Revertability;
  readonly linkedProposals?: readonly ProposalLinkView[];
};

export type PerPageNotificationsView = {
  readonly value: boolean;
  readonly isEnabledBySettings: boolean;
};

export type RequesterProposalState = {
  readonly lifecycle: ProposalLifecycle;
  readonly achievement?: ProposalAchievement;
  readonly perPageNotifications: PerPageNotificationsView;
};

export type ChangeProposalView = {
  readonly id: string;
  readonly requester: {
    readonly id: string;
    readonly username: string;
    readonly name: string;
  };
  readonly entry: ProposalEntry;
  readonly modelLabel?: string;
  readonly createdAt: string;
  readonly lastAppliedAt?: string;
  readonly status: ProposalStatus;
  readonly isRequester: boolean;
  readonly revertOf?: string;
  readonly basedOn?: BasedOn;
  readonly requesterState?: RequesterProposalState;
  readonly operations: readonly OperationView[];
};

export type ChangeProposalSummaryView = Omit<
  ChangeProposalView,
  'operations' | 'basedOn'
> & {
  readonly pages: readonly { readonly id: string; readonly path: string }[];
};

export type RevisionMarkView = {
  readonly revisionId: string;
  readonly proposalId: string;
  readonly isRevert: boolean;
};

export type ApplyTrigger =
  | { readonly kind: 'request'; readonly activityId: string }
  | { readonly kind: 'background' };

export type ApplyResult =
  | {
      readonly type: 'done';
      readonly results: readonly {
        readonly key: string;
        readonly status: OperationStatus;
        readonly reason?: OperationReason;
      }[];
    }
  | { readonly type: 'in-progress' };

export type RevertResult = {
  readonly revertProposalId?: string;
  readonly operations: readonly (
    | { readonly key: string; readonly outcome: 'reverted' }
    | {
        readonly key: string;
        readonly outcome: 'revert-refused';
        readonly reason: RevertRefusalReason;
      }
    | {
        readonly key: string;
        readonly outcome: 'skipped';
        readonly reason: 'page-being-edited';
      }
  )[];
};
