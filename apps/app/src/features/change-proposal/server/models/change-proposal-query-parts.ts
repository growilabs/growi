import { randomUUID } from 'node:crypto';
import { isValidObjectId } from '@growi/core/dist/utils/objectid-utils';

import type {
  ChangeproposalsBasedOn,
  ChangeproposalsReviewers,
  Prisma,
} from '~/generated/prisma/client';

import type {
  OperationStatus,
  ProposalEntry,
  ReviewerInput,
  ReviewerKind,
} from '../../interfaces';
import {
  activeReviewers,
  deriveViewerRole,
  isReviewer,
  type ViewerIdentity,
} from '../domain';
import type {
  AttributedApproval,
  ClosingLifecycle,
  CreateOperationInput,
  LinkedOperation,
  LinkedProposalRecord,
  OriginalOperationChange,
  RecordedOutcome,
  RequesterWriteResult,
  RevertCounterpartRecord,
  ReviewEntry,
} from './change-proposal-types';
import {
  required,
  toBasedOn,
  toOperationStatus,
  toOperationType,
  toProposalEntry,
  toReviewerRef,
} from './to-change-proposal-document';

// An approval's by/channel/token are meaningless without approvedAt, so they go together.
export const UNSET_APPROVAL = {
  approvedAt: { unset: true },
  approvedBy: { unset: true },
  approvedChannel: { unset: true },
  decisionToken: { unset: true },
} satisfies Prisma.ChangeproposalsOperationsUpdateInput;

export const PENDING: OperationStatus = 'pending';
export const REVERT_ENTRY: ProposalEntry = 'revert';
export const SETTLED = 'settled';

export const operationSummarySelect = {
  select: {
    index: true,
    key: true,
    type: true,
    status: true,
    reason: true,
    pageId: true,
    baseRevisionId: true,
    expectedRevisionId: true,
    path: true,
    fromPath: true,
    toPath: true,
    removeRedirectsFrom: true,
    approvedAt: true,
    appliedAt: true,
    resultPageId: true,
    resultRevisionId: true,
    revertTarget: true,
    revertedByProposalId: true,
    revertedAt: true,
    approvedBy: true,
    approvedChannel: true,
    decisionToken: true,
  },
} satisfies Prisma.ChangeproposalsOperationsDefaultArgs;

export const summarySelect = {
  id: true,
  requester: true,
  entry: true,
  modelLabel: true,
  revertOf: true,
  basedOn: true,
  lifecycle: true,
  operations: operationSummarySelect,
  appliedPageIds: true,
  lastAppliedAt: true,
  applyLease: true,
  expiresAt: true,
  perPageNotifications: true,
  purpose: true,
  reviewers: true,
  reviews: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.changeproposalsSelect;

export const hasPendingOperation = {
  operations: { some: { status: PENDING } },
} satisfies Prisma.changeproposalsWhereInput;

// Prisma tells an absent field apart from a null one, so both count as "no lease".
export const leaseFreeAt = (now: Date): Prisma.changeproposalsWhereInput => ({
  OR: [
    { applyLease: { isSet: false } },
    { applyLease: { equals: null } },
    { applyLease: { is: { expiresAt: { lt: now } } } },
  ],
});

export const closableWhere = (
  closing: ClosingLifecycle,
  now: Date,
): Prisma.changeproposalsWhereInput => ({
  lifecycle: 'open',
  ...hasPendingOperation,
  AND: [
    leaseFreeAt(now),
    closing === 'expired'
      ? { expiresAt: { lte: now } }
      : { entry: { not: REVERT_ENTRY } },
  ],
});

export const settleableWhere = {
  lifecycle: 'open',
  operations: { none: { status: PENDING } },
} satisfies Prisma.changeproposalsWhereInput;

export const interruptedApplyWhere = (
  now: Date,
): Prisma.changeproposalsWhereInput => ({
  lifecycle: 'open',
  operations: {
    some: { status: PENDING, approvedAt: { isSet: true, not: null } },
  },
  AND: [leaseFreeAt(now)],
});

// Lets a maintenance run skip the ids it already tried; those may keep matching
// and would otherwise fill every batch.
export const idNotIn = (
  excludeIds: readonly string[],
): Prisma.changeproposalsWhereInput =>
  excludeIds.length === 0 ? {} : { id: { notIn: [...excludeIds] } };

export const withoutUndefined = <T extends Record<string, unknown>>(
  value: T,
): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;

export const toOperationCreateInput = (
  op: CreateOperationInput,
  index: number,
): Prisma.ChangeproposalsOperationsCreateInput =>
  withoutUndefined({
    ...op,
    index,
    key: randomUUID(),
    status: PENDING,
    revertTarget:
      op.revertTarget == null
        ? undefined
        : {
            proposalId: op.revertTarget.proposalId,
            operationKey: op.revertTarget.operationKey,
          },
  });

export const toOutcomeData = (
  outcome: RecordedOutcome,
  now: Date,
): Prisma.ChangeproposalsOperationsUpdateInput => {
  switch (outcome.status) {
    case 'applied':
      return {
        status: outcome.status,
        reason: { unset: true },
        appliedAt: now,
        resultPageId: outcome.resultPageId,
        ...(outcome.resultRevisionId == null
          ? {}
          : { resultRevisionId: outcome.resultRevisionId }),
        ...(outcome.appliedPagePath == null
          ? {}
          : { path: outcome.appliedPagePath }),
      };
    case 'pending':
      return {
        reason: outcome.reason,
        ...UNSET_APPROVAL,
      };
    default:
      return { status: outcome.status, reason: outcome.reason };
  }
};

export const toOriginalOperationData = (
  change: OriginalOperationChange,
): Prisma.ChangeproposalsOperationsUpdateInput =>
  change.status === 'reverted'
    ? {
        status: change.status,
        reason: { unset: true },
        revertedByProposalId: change.revertedByProposalId,
        revertedAt: change.revertedAt,
      }
    : { status: change.status, reason: change.reason };

type LinkedOperationRow = {
  key: string;
  type: string;
  status: string;
  pageId: string | null;
  path: string | null;
  toPath: string | null;
  resultPageId: string | null;
  revertedByProposalId: string | null;
};

const toLinkedOperation = (op: LinkedOperationRow): LinkedOperation => {
  const type = toOperationType(op.type);
  const state = {
    key: op.key,
    status: toOperationStatus(op.status),
    ...(op.resultPageId == null ? {} : { resultPageId: op.resultPageId }),
    ...(op.revertedByProposalId == null
      ? {}
      : { revertedByProposalId: op.revertedByProposalId }),
  };
  switch (type) {
    case 'create':
      return { ...state, type, path: required(op.path, 'path', type) };
    case 'move':
      return {
        ...state,
        type,
        pageId: required(op.pageId, 'pageId', type),
        toPath: required(op.toPath, 'toPath', type),
      };
    default:
      return { ...state, type, pageId: required(op.pageId, 'pageId', type) };
  }
};

export const toLinkedProposalRecord = (row: {
  id: string;
  requester: string;
  entry: string;
  basedOn: ChangeproposalsBasedOn | null;
  reviewers: ChangeproposalsReviewers[];
  operations: LinkedOperationRow[];
}): LinkedProposalRecord => {
  if (row.basedOn == null) {
    throw new Error(`Linked change proposal ${row.id} has no basedOn`);
  }
  return {
    id: row.id,
    requester: row.requester,
    entry: toProposalEntry(row.entry),
    basedOn: toBasedOn(row.basedOn),
    reviewers: row.reviewers.map(toReviewerRef),
    operations: row.operations.map(toLinkedOperation),
  };
};

export const toRevertCounterpartRecord = (row: {
  id: string;
  requester: string;
  operations: { key: string; type: string; path: string | null }[];
}): RevertCounterpartRecord => ({
  id: row.id,
  requester: row.requester,
  operations: row.operations.map((op) => ({
    key: op.key,
    type: toOperationType(op.type),
    ...(op.path == null ? {} : { path: op.path }),
  })),
});

// Tells why a requester-scoped conditional write matched nothing.
export const toRequesterWriteMiss = (
  row: { readonly requester: string } | null,
  requesterId: string,
): RequesterWriteResult =>
  row == null || row.requester !== requesterId
    ? { ok: false, code: 'not-found' }
    : { ok: false, code: 'not-open' };

// Prisma tells an absent field apart from a null one, so both count as "not approved".
export const unapprovedOperation = {
  OR: [{ approvedAt: { isSet: false } }, { approvedAt: null }],
} satisfies Prisma.ChangeproposalsOperationsWhereInput;

const reviewerIdsOfKind = (
  kind: ReviewerKind,
  ids: Iterable<string>,
): Prisma.ChangeproposalsReviewersWhereInput[] => {
  const valid = [...ids].filter((id) => isValidObjectId(id));
  return valid.length === 0 ? [] : [{ kind, id: { in: valid } }];
};

// Prisma tells an absent field apart from a null one, so both count as "not removed".
const notRemoved = {
  OR: [{ removedAt: { isSet: false } }, { removedAt: null }],
} satisfies Prisma.ChangeproposalsReviewersWhereInput;

// A reviewer entry that names the viewer or one of the viewer's groups, and was not removed.
const activeReviewerMatching = (
  viewer: ViewerIdentity,
): Prisma.ChangeproposalsReviewersWhereInput => ({
  AND: [
    {
      OR: [
        ...reviewerIdsOfKind('user', [viewer.userId]),
        ...reviewerIdsOfKind('user-group', viewer.userGroupIds),
        ...reviewerIdsOfKind(
          'external-user-group',
          viewer.externalUserGroupIds,
        ),
      ],
    },
    notRemoved,
  ],
});

export const activeReviewerEntries = (
  inputs: readonly ReviewerInput[],
): Prisma.ChangeproposalsReviewersWhereInput => ({
  AND: [
    { OR: inputs.map((input) => ({ kind: input.kind, id: input.id })) },
    notRemoved,
  ],
});

export const reviewerWhere = (
  viewer: ViewerIdentity,
): Prisma.changeproposalsWhereInput => ({
  reviewers: { some: activeReviewerMatching(viewer) },
});

// The requester may always act on their proposal, whoever the reviewers are.
export const requesterOrReviewerWhere = (
  viewer: ViewerIdentity,
): Prisma.changeproposalsWhereInput => ({
  OR: [{ requester: viewer.userId }, reviewerWhere(viewer)],
});

export const approverWhere = (
  approver: string | AttributedApproval,
): Prisma.changeproposalsWhereInput =>
  typeof approver === 'string'
    ? { requester: approver }
    : requesterOrReviewerWhere(approver.approver);

export const toApprovalData = (
  now: Date,
  approver: string | AttributedApproval,
): Prisma.ChangeproposalsOperationsUpdateInput =>
  typeof approver === 'string'
    ? { approvedAt: now }
    : // Keyed like UNSET_APPROVAL so the fields written and the fields cleared cannot drift apart.
      ({
        approvedAt: now,
        approvedBy: approver.approver.userId,
        approvedChannel: approver.channel,
        decisionToken: approver.decisionToken,
      } satisfies Record<keyof typeof UNSET_APPROVAL, unknown>);

// Tells why an approval write matched nothing; the approver may have been removed
// from the reviewers after the caller's check, which reads as not-found.
export const toReviewerWriteMiss = (
  row: {
    readonly requester: string;
    readonly reviewers: readonly ChangeproposalsReviewers[];
  } | null,
  approver: ViewerIdentity,
): RequesterWriteResult =>
  row == null ||
  deriveViewerRole(
    row.requester,
    row.reviewers.map(toReviewerRef),
    approver,
  ) === 'other'
    ? { ok: false, code: 'not-found' }
    : { ok: false, code: 'not-open' };

type ReviewerScopedRow = {
  readonly requester: string;
  readonly lifecycle: string;
  readonly reviewers: readonly ChangeproposalsReviewers[];
};

export const isRequesterOrReviewer = (
  row: ReviewerScopedRow,
  viewer: ViewerIdentity,
): boolean =>
  deriveViewerRole(row.requester, row.reviewers.map(toReviewerRef), viewer) !==
  'other';

// Matches reviewerWhere: an active entry names the viewer. With no active entries
// nobody is, although the requester would then count as a reviewer for approving.
export const isActiveReviewer = (
  row: ReviewerScopedRow,
  viewer: ViewerIdentity,
): boolean => {
  const refs = row.reviewers.map(toReviewerRef);
  return (
    activeReviewers(refs).length > 0 && isReviewer(refs, row.requester, viewer)
  );
};

export const isActiveReviewerEntry = (
  row: ReviewerScopedRow,
  input: ReviewerInput,
): boolean =>
  activeReviewers(row.reviewers.map(toReviewerRef)).some(
    (r) => r.kind === input.kind && r.id === input.id,
  );

// Tells why a write limited to open proposals and to permitted actors matched nothing,
// or null when neither explains it.
export const explainOpenWriteMiss = (
  row: ReviewerScopedRow | null,
  permitted: (row: ReviewerScopedRow) => boolean,
): Extract<RequesterWriteResult, { ok: false }> | null => {
  if (row == null || !permitted(row)) {
    return { ok: false, code: 'not-found' };
  }
  return row.lifecycle === 'open' ? null : { ok: false, code: 'not-open' };
};

// Prisma tells an absent field apart from a null one, so both count as "no operation key".
const wholeProposalReview = {
  OR: [{ operationKey: { isSet: false } }, { operationKey: null }],
} satisfies Prisma.ChangeproposalsReviewsWhereInput;

// Without isSet, Prisma's `in` on a composite list element also matches a record whose
// operationKey is absent, which is a whole rejection.
const reviewsOfOperations = (
  operationKeys: readonly string[],
): Prisma.ChangeproposalsReviewsWhereInput => ({
  operationKey: { isSet: true, in: [...operationKeys] },
});

// Only records older than the replacement, so the replacement itself survives.
export const reviewsReplacedBy = (
  by: string,
  entry: ReviewEntry,
  now: Date,
): Prisma.ChangeproposalsReviewsWhereInput => ({
  by,
  at: { lt: now },
  ...(entry.target.scope === 'whole'
    ? wholeProposalReview
    : reviewsOfOperations(entry.target.operationKeys)),
});

export const reviewsClearedByApproval = (
  by: string,
  operationKeys: readonly string[],
  wholeProposal: boolean,
): Prisma.ChangeproposalsReviewsWhereInput => ({
  by,
  OR: [
    reviewsOfOperations(operationKeys),
    ...(wholeProposal ? [wholeProposalReview] : []),
  ],
});

export const toReviewCreateInputs = (
  by: string,
  entry: ReviewEntry,
  now: Date,
): Prisma.ChangeproposalsReviewsCreateInput[] => {
  const record = withoutUndefined({
    kind: entry.kind,
    by,
    at: now,
    comment: entry.comment,
    channel: entry.channel,
  });
  const { target } = entry;
  return target.scope === 'whole'
    ? [record]
    : target.operationKeys.map((operationKey) => ({ ...record, operationKey }));
};
