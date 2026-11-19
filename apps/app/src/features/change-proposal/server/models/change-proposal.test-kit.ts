import mongoose from 'mongoose';

import { prisma } from '~/utils/prisma';

import type { ReviewerKind, ReviewerRef } from '../../interfaces';
import type { ViewerIdentity } from '../domain';
import type { CreateProposalInput } from './change-proposal-types';

// Concurrency checks: 2 callers rarely overlap enough to expose a split read/write,
// so each round fires CONCURRENCY callers and repeats ROUNDS times.
export const CONCURRENCY = 12;
export const ROUNDS = 20;
export const CONCURRENCY_TIMEOUT_MS = 120_000;

export const newObjectId = (): string =>
  new mongoose.Types.ObjectId().toString();

// Fixtures are scoped to requesters minted by the integ file, so cleanup never touches
// documents another integration file created in the same per-worker database.
const requesterIds: string[] = [];
export const newRequester = (): string => {
  const id = newObjectId();
  requesterIds.push(id);
  return id;
};

export const deleteProposalsOfMintedRequesters = async (): Promise<void> => {
  await prisma.changeproposals.deleteMany({
    where: { requester: { in: requesterIds } },
  });
};

export const PAGE_A = newObjectId();
export const REVISION_A = newObjectId();

export const editOp = (pageId = PAGE_A, body = 'edit body') =>
  ({
    type: 'edit',
    pageId,
    baseRevisionId: REVISION_A,
    body,
  }) as const;
export const createOp = (path: string, body = 'create body') =>
  ({ type: 'create', path, body }) as const;

export const createProposal = (
  overrides: Partial<CreateProposalInput> = {},
): ReturnType<typeof prisma.changeproposals.createProposal> =>
  prisma.changeproposals.createProposal({
    requester: overrides.requester ?? newRequester(),
    entry: 'ai-chat',
    perPageNotifications: true,
    operations: [editOp(), createOp('/cp-integ/new')],
    ...overrides,
  });

export const identityOf = (
  userId: string,
  groups: {
    readonly userGroupIds?: readonly string[];
    readonly externalUserGroupIds?: readonly string[];
  } = {},
): ViewerIdentity => ({
  userId,
  userGroupIds: new Set(groups.userGroupIds ?? []),
  externalUserGroupIds: new Set(groups.externalUserGroupIds ?? []),
});

export const reviewerRef = (
  kind: ReviewerKind,
  id: string,
  removedAt?: Date,
): ReviewerRef => ({
  kind,
  id,
  addedBy: newObjectId(),
  addedAt: new Date(),
  ...(removedAt == null ? {} : { removedBy: newObjectId(), removedAt }),
});

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
