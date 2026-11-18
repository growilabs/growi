import type {
  ChangeproposalsBasedOn,
  ChangeproposalsOperations,
  ChangeproposalsReviewers,
  ChangeproposalsReviews,
  changeproposals,
} from '~/generated/prisma/client';

import type {
  BasedOn,
  BasedOnRelation,
  ChangeProposalDocument,
  OperationPayload,
  OperationReason,
  OperationRecord,
  OperationStatus,
  OperationType,
  ProposalEntry,
  ProposalLifecycle,
  ReviewChannel,
  ReviewerKind,
  ReviewerRef,
  ReviewKind,
  ReviewRecord,
} from '../../interfaces';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type OperationSummaryRecord = DistributiveOmit<OperationRecord, 'body'>;

export type ChangeProposalSummary = Omit<
  ChangeProposalDocument,
  'operations'
> & {
  readonly id: string;
  readonly operations: readonly OperationSummaryRecord[];
};

type OperationRowWithoutBody = Omit<ChangeproposalsOperations, 'body'>;
type ProposalRowWithoutBodies = Omit<changeproposals, 'operations' | 'v'> & {
  readonly operations: readonly OperationRowWithoutBody[];
};

// Record<Union, true> makes the compiler flag a value added to the union but missing here.
const ENTRIES: Record<ProposalEntry, true> = {
  'ai-chat': true,
  vault: true,
  mcp: true,
  revert: true,
};
const LIFECYCLES: Record<ProposalLifecycle, true> = {
  open: true,
  settled: true,
  discarded: true,
  expired: true,
  withdrawn: true,
};
const OPERATION_TYPES: Record<OperationType, true> = {
  edit: true,
  create: true,
  move: true,
  'delete-completely': true,
};
const OPERATION_STATUSES: Record<OperationStatus, true> = {
  pending: true,
  applied: true,
  failed: true,
  stale: true,
  skipped: true,
  reverted: true,
  'revert-refused': true,
};
const OPERATION_REASONS: Record<OperationReason, true> = {
  'page-being-edited': true,
  'page-operation-in-progress': true,
  'target-unavailable': true,
  'path-occupied': true,
  'grant-not-assignable': true,
  'feature-disabled': true,
  'operation-type-disabled': true,
  'requester-not-allowed': true,
  'write-error': true,
  'not-revertible-state': true,
  'edited-after-apply': true,
  'has-children': true,
  'moved-after-apply': true,
  'original-path-occupied': true,
  'not-deletable': true,
  'apply-failed': true,
  'base-revision-changed': true,
  'skipped-by-requester': true,
  discarded: true,
  expired: true,
  withdrawn: true,
};
const RELATIONS: Record<BasedOnRelation, true> = {
  'follow-up': true,
  rework: true,
};

const REVIEWER_KINDS: Record<ReviewerKind, true> = {
  user: true,
  'user-group': true,
  'external-user-group': true,
};
const REVIEW_KINDS: Record<ReviewKind, true> = { reject: true, abstain: true };
const REVIEW_CHANNELS: Record<ReviewChannel, true> = {
  ui: true,
  api: true,
  'ai-tool': true,
};

const toMember = <T extends string>(
  members: Record<T, true>,
  value: string,
  field: string,
): T => {
  if (!Object.hasOwn(members, value)) {
    throw new Error(`Unknown change proposal ${field}: '${value}'`);
  }
  return value as T;
};

export const required = <T>(
  value: T | null | undefined,
  field: string,
  type: string,
): T => {
  if (value == null) {
    throw new Error(`Change proposal ${type} operation is missing '${field}'`);
  }
  return value;
};

// Prisma returns null for an absent optional field; the document shape omits the key instead.
const optional = <K extends string, V>(
  key: K,
  value: V | null | undefined,
): { [P in K]?: V } =>
  (value == null ? {} : { [key]: value }) as { [P in K]?: V };

const toPayloadWithoutBody = (
  row: OperationRowWithoutBody,
): DistributiveOmit<OperationPayload, 'body'> => {
  const type = toMember(OPERATION_TYPES, row.type, 'operation type');
  switch (type) {
    case 'edit':
      return {
        type,
        pageId: required(row.pageId, 'pageId', type),
        baseRevisionId: required(row.baseRevisionId, 'baseRevisionId', type),
      };
    case 'create':
      return { type, path: required(row.path, 'path', type) };
    case 'move':
      return {
        type,
        pageId: required(row.pageId, 'pageId', type),
        fromPath: required(row.fromPath, 'fromPath', type),
        toPath: required(row.toPath, 'toPath', type),
        ...optional('removeRedirectsFrom', row.removeRedirectsFrom),
      };
    case 'delete-completely':
      return {
        type,
        pageId: required(row.pageId, 'pageId', type),
        expectedRevisionId: required(
          row.expectedRevisionId,
          'expectedRevisionId',
          type,
        ),
      };
  }
};

const toOperationState = (row: OperationRowWithoutBody) => ({
  index: row.index,
  key: row.key,
  status: toMember(OPERATION_STATUSES, row.status, 'operation status'),
  ...(row.reason == null
    ? {}
    : { reason: toMember(OPERATION_REASONS, row.reason, 'operation reason') }),
  ...optional('approvedAt', row.approvedAt),
  ...optional('approvedBy', row.approvedBy),
  ...(row.approvedChannel == null
    ? {}
    : {
        approvedChannel: toMember(
          REVIEW_CHANNELS,
          row.approvedChannel,
          'approval channel',
        ),
      }),
  ...optional('decisionToken', row.decisionToken),
  ...optional('appliedAt', row.appliedAt),
  ...optional('resultPageId', row.resultPageId),
  ...optional('resultRevisionId', row.resultRevisionId),
  ...(row.revertTarget == null
    ? {}
    : {
        revertTarget: {
          proposalId: row.revertTarget.proposalId,
          operationKey: row.revertTarget.operationKey,
        },
      }),
  ...optional('revertedByProposalId', row.revertedByProposalId),
  ...optional('revertedAt', row.revertedAt),
});

// An edit reuses the create's `path` field for the page path at apply time.
const toOperationSummaryRecord = (
  row: OperationRowWithoutBody,
): OperationSummaryRecord => {
  const payload = toPayloadWithoutBody(row);
  return {
    ...payload,
    ...toOperationState(row),
    ...(payload.type === 'edit' ? optional('appliedPagePath', row.path) : {}),
  };
};

const toOperationRecord = (row: ChangeproposalsOperations): OperationRecord => {
  const summary = toOperationSummaryRecord(row);
  if (summary.type === 'edit' || summary.type === 'create') {
    return { ...summary, body: required(row.body, 'body', summary.type) };
  }
  return summary;
};

export const toBasedOn = (row: ChangeproposalsBasedOn): BasedOn => ({
  proposalId: row.proposalId,
  relation: toMember(RELATIONS, row.relation, 'basedOn relation'),
  operationKeys: [...row.operationKeys],
});

export const toReviewerRef = (row: ChangeproposalsReviewers): ReviewerRef => ({
  kind: toMember(REVIEWER_KINDS, row.kind, 'reviewer kind'),
  id: row.id,
  addedBy: row.addedBy,
  addedAt: row.addedAt,
  ...optional('removedBy', row.removedBy),
  ...optional('removedAt', row.removedAt),
});

const toReviewRecord = (row: ChangeproposalsReviews): ReviewRecord => ({
  kind: toMember(REVIEW_KINDS, row.kind, 'review kind'),
  ...optional('operationKey', row.operationKey),
  by: row.by,
  at: row.at,
  ...optional('comment', row.comment),
  channel: toMember(REVIEW_CHANNELS, row.channel, 'review channel'),
});

const toProposalFields = (row: ProposalRowWithoutBodies) => ({
  _id: row.id,
  requester: row.requester,
  entry: toMember(ENTRIES, row.entry, 'entry'),
  ...optional('modelLabel', row.modelLabel),
  ...optional('revertOf', row.revertOf),
  ...(row.basedOn == null ? {} : { basedOn: toBasedOn(row.basedOn) }),
  lifecycle: toMember(LIFECYCLES, row.lifecycle, 'lifecycle'),
  appliedPageIds: [...row.appliedPageIds],
  ...optional('lastAppliedAt', row.lastAppliedAt),
  ...(row.applyLease == null
    ? {}
    : {
        applyLease: {
          token: row.applyLease.token,
          expiresAt: row.applyLease.expiresAt,
        },
      }),
  ...optional('expiresAt', row.expiresAt),
  perPageNotifications: row.perPageNotifications,
  ...optional('purpose', row.purpose),
  reviewers: row.reviewers.map(toReviewerRef),
  reviews: row.reviews.map(toReviewRecord),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * Maps a full Prisma row onto the document shape, validating every stored value.
 * Throws on a row that only a direct DB edit could produce.
 */
export const toChangeProposalDocument = (
  row: changeproposals,
): ChangeProposalDocument => ({
  ...toProposalFields(row),
  operations: row.operations.map(toOperationRecord),
});

/** Same as toChangeProposalDocument for rows read without the operation bodies. */
export const toChangeProposalSummary = (
  row: ProposalRowWithoutBodies,
): ChangeProposalSummary => ({
  ...toProposalFields(row),
  id: row.id,
  operations: row.operations.map(toOperationSummaryRecord),
});

export const toOperationType = (value: string): OperationType =>
  toMember(OPERATION_TYPES, value, 'operation type');
export const toOperationStatus = (value: string): OperationStatus =>
  toMember(OPERATION_STATUSES, value, 'operation status');
export const toProposalEntry = (value: string): ProposalEntry =>
  toMember(ENTRIES, value, 'entry');
