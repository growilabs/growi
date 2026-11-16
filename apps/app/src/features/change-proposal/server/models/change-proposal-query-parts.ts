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
  ReviewerKind,
} from '../../interfaces';
import { deriveViewerRole, type ViewerIdentity } from '../domain';
import type {
  AttributedApproval,
  ClosingLifecycle,
  CreateOperationInput,
  LinkedProposalRecord,
  OriginalOperationChange,
  RecordedOutcome,
  RequesterWriteResult,
} from './change-proposal-types';
import {
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

export const toLinkedProposalRecord = (row: {
  id: string;
  requester: string;
  entry: string;
  basedOn: ChangeproposalsBasedOn | null;
  operations: {
    key: string;
    type: string;
    status: string;
    pageId: string | null;
    resultPageId: string | null;
  }[];
}): LinkedProposalRecord => {
  if (row.basedOn == null) {
    throw new Error(`Linked change proposal ${row.id} has no basedOn`);
  }
  return {
    id: row.id,
    requester: row.requester,
    entry: toProposalEntry(row.entry),
    basedOn: toBasedOn(row.basedOn),
    operations: row.operations.map((op) => ({
      key: op.key,
      type: toOperationType(op.type),
      status: toOperationStatus(op.status),
      ...(op.pageId == null ? {} : { pageId: op.pageId }),
      ...(op.resultPageId == null ? {} : { resultPageId: op.resultPageId }),
    })),
  };
};

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
    { OR: [{ removedAt: { isSet: false } }, { removedAt: null }] },
  ],
});

// The requester may always approve, whoever the reviewers are.
export const approverWhere = (
  approver: string | AttributedApproval,
): Prisma.changeproposalsWhereInput =>
  typeof approver === 'string'
    ? { requester: approver }
    : {
        OR: [
          { requester: approver.approver.userId },
          {
            reviewers: { some: activeReviewerMatching(approver.approver) },
          },
        ],
      };

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
