import type {
  BasedOnRelation,
  OperationReason,
  OperationStatus,
  OperationType,
  ProposalLifecycle,
  ProposalStatus,
  RevertRefusalReason,
} from '../../interfaces';

// The `translation` namespace only: the admin pages do not load it, so these tables are not for admin screens.
export const OPERATION_TYPE_LABEL_KEYS = {
  edit: 'change_proposal.operation_type.edit',
  create: 'change_proposal.operation_type.create',
  move: 'change_proposal.operation_type.move',
  trash: 'change_proposal.operation_type.trash',
  restore: 'change_proposal.operation_type.restore',
} as const satisfies Record<OperationType, string>;

export const OPERATION_STATUS_LABEL_KEYS = {
  pending: 'change_proposal.operation_status.pending',
  applied: 'change_proposal.operation_status.applied',
  failed: 'change_proposal.operation_status.failed',
  stale: 'change_proposal.operation_status.stale',
  skipped: 'change_proposal.operation_status.skipped',
  reverted: 'change_proposal.operation_status.reverted',
  'revert-refused': 'change_proposal.operation_status.revert_refused',
} as const satisfies Record<OperationStatus, string>;

export const PROPOSAL_STATUS_LABEL_KEYS = {
  pending: 'change_proposal.proposal_status.pending',
  applied: 'change_proposal.proposal_status.applied',
  'partially-applied': 'change_proposal.proposal_status.partially_applied',
  reverted: 'change_proposal.proposal_status.reverted',
  'partially-reverted': 'change_proposal.proposal_status.partially_reverted',
  'not-applied': 'change_proposal.proposal_status.not_applied',
  discarded: 'change_proposal.proposal_status.discarded',
  expired: 'change_proposal.proposal_status.expired',
  withdrawn: 'change_proposal.proposal_status.withdrawn',
} as const satisfies Record<ProposalStatus, string>;

export const OPERATION_REASON_LABEL_KEYS = {
  'page-being-edited': 'change_proposal.reason.page_being_edited',
  'page-operation-in-progress':
    'change_proposal.reason.page_operation_in_progress',
  'target-unavailable': 'change_proposal.reason.target_unavailable',
  'path-occupied': 'change_proposal.reason.path_occupied',
  'grant-not-assignable': 'change_proposal.reason.grant_not_assignable',
  'feature-disabled': 'change_proposal.reason.feature_disabled',
  'operation-type-disabled': 'change_proposal.reason.operation_type_disabled',
  'requester-not-allowed': 'change_proposal.reason.requester_not_allowed',
  'write-error': 'change_proposal.reason.write_error',
  'not-revertible-state': 'change_proposal.reason.not_revertible_state',
  'edited-after-apply': 'change_proposal.reason.edited_after_apply',
  'has-children': 'change_proposal.reason.has_children',
  'moved-after-apply': 'change_proposal.reason.moved_after_apply',
  'original-path-occupied': 'change_proposal.reason.original_path_occupied',
  'not-in-trash': 'change_proposal.reason.not_in_trash',
  'apply-failed': 'change_proposal.reason.apply_failed',
  'base-revision-changed': 'change_proposal.reason.base_revision_changed',
  'skipped-by-requester': 'change_proposal.reason.skipped_by_requester',
  discarded: 'change_proposal.reason.discarded',
  expired: 'change_proposal.reason.expired',
  withdrawn: 'change_proposal.reason.withdrawn',
} as const satisfies Record<OperationReason, string>;

export const REVERT_REFUSAL_REASON_LABEL_KEYS = {
  'not-revertible-state':
    'change_proposal.revert_refusal_reason.not_revertible_state',
  'target-unavailable':
    'change_proposal.revert_refusal_reason.target_unavailable',
  'edited-after-apply':
    'change_proposal.revert_refusal_reason.edited_after_apply',
  'has-children': 'change_proposal.revert_refusal_reason.has_children',
  'moved-after-apply':
    'change_proposal.revert_refusal_reason.moved_after_apply',
  'original-path-occupied':
    'change_proposal.revert_refusal_reason.original_path_occupied',
  'not-in-trash': 'change_proposal.revert_refusal_reason.not_in_trash',
  'page-operation-in-progress':
    'change_proposal.revert_refusal_reason.page_operation_in_progress',
  'apply-failed': 'change_proposal.revert_refusal_reason.apply_failed',
} as const satisfies Record<RevertRefusalReason, string>;

export const PROPOSAL_LIFECYCLE_LABEL_KEYS = {
  open: 'change_proposal.lifecycle.open',
  settled: 'change_proposal.lifecycle.settled',
  discarded: 'change_proposal.lifecycle.discarded',
  expired: 'change_proposal.lifecycle.expired',
  withdrawn: 'change_proposal.lifecycle.withdrawn',
} as const satisfies Record<ProposalLifecycle, string>;

// 'based-on' labels the link from a derived proposal back to its base.
export type ProposalLinkKind = BasedOnRelation | 'based-on';

export const PROPOSAL_LINK_LABEL_KEYS = {
  'follow-up': 'change_proposal.link.follow_up',
  rework: 'change_proposal.link.rework',
  'based-on': 'change_proposal.link.based_on',
} as const satisfies Record<ProposalLinkKind, string>;

// Takes `{ percent }` (see toAchievementPercent).
export const ACHIEVEMENT_LABEL_KEY =
  'change_proposal.achievement.settled_with_percent';
