import { randomUUID } from 'node:crypto';
import { PageGrant } from '@growi/core';
import { Types } from 'mongoose';

import { PageActionStage, PageActionType } from '~/interfaces/page-operation';
import type { PageDocument } from '~/server/models/page';
import PageOperation from '~/server/models/page-operation';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:services:page:duplicate:duplicate-page-operation',
);

// Values and the take-over conditions: design.md duplicatePageOperation / State Management.
export const STALL_THRESHOLD_MS = 2 * 60 * 1000;
export const LEGACY_RECORD_MIN_AGE_MS = 15 * 60 * 1000;

/** Thrown when this process is no longer the owner of the PageOperation. */
export class OwnershipLostError extends Error {
  constructor(operationId: string) {
    super(`No longer the owner of the duplicate PageOperation ${operationId}`);
    this.name = 'OwnershipLostError';
  }
}

/** A duplicate PageOperation together with the ownerToken this process holds. */
export interface OwnedDuplicatePageOperation {
  readonly operationId: string;
  readonly ownerToken: string;
}

/** The stored values of a PageOperation taken over by the cron, as-is. */
export interface StalledDuplicatePageOperation {
  readonly operation: OwnedDuplicatePageOperation;
  readonly fromPath: string;
  readonly toPath: string;
  readonly userId: string;
  readonly sourceGrant: PageGrant;
  readonly sourceDescendantCount: number;
  readonly sourceIsEmpty: boolean;
}

export async function createDuplicatePageOperation(input: {
  readonly page: PageDocument;
  readonly userId: string;
  readonly fromPath: string;
  readonly toPath: string;
}): Promise<OwnedDuplicatePageOperation> {
  const ownerToken = randomUUID();
  const created = await PageOperation.create({
    actionType: PageActionType.Duplicate,
    actionStage: PageActionStage.Main,
    page: input.page,
    user: { _id: input.userId },
    fromPath: input.fromPath,
    toPath: input.toPath,
    ownerToken,
    lastProgressAt: new Date(),
  });
  return { operationId: created._id.toString(), ownerToken };
}

/** Returns a callback that updates lastProgressAt; it throws OwnershipLostError when not the owner. */
export function recordProgress(
  operation: OwnedDuplicatePageOperation,
): () => Promise<void> {
  return async () => {
    const result = await PageOperation.updateOne(
      { _id: operation.operationId, ownerToken: operation.ownerToken },
      { $set: { lastProgressAt: new Date() } },
    );
    if (result.matchedCount === 0) {
      throw new OwnershipLostError(operation.operationId);
    }
  };
}

const isPageGrant = (value: unknown): value is PageGrant =>
  Object.values<unknown>(PageGrant).includes(value);

/** Sets this ownerToken on the oldest expired duplicate PageOperation, if any, and returns it. */
const takeOverOldestExpired = (now: Date, ownerToken: string) => {
  const stalledBefore = new Date(now.getTime() - STALL_THRESHOLD_MS);
  // ObjectId timestamps have second precision; createFromTime takes seconds.
  const legacyCreatedBefore = Types.ObjectId.createFromTime(
    Math.floor((now.getTime() - LEGACY_RECORD_MIN_AGE_MS) / 1000),
  );
  return PageOperation.findOneAndUpdate(
    {
      actionType: PageActionType.Duplicate,
      $or: [
        {
          ownerToken: { $exists: true },
          lastProgressAt: { $lt: stalledBefore },
        },
        { ownerToken: { $exists: false }, _id: { $lt: legacyCreatedBefore } },
      ],
    },
    { $set: { ownerToken, lastProgressAt: now } },
    { new: true, sort: { _id: 1 } },
  );
};

/**
 * Atomically takes over one PageOperation judged expired by lastProgressAt.
 * One that lacks a stored value cannot be recovered, so it is deleted and the
 * next expired one is looked for instead.
 */
export async function takeOverStalledDuplicate(
  now: Date,
): Promise<StalledDuplicatePageOperation | null> {
  for (;;) {
    const ownerToken = randomUUID();
    // biome-ignore lint/performance/noAwaitInLoops: whether to look further depends on what this take-over returns
    const taken = await takeOverOldestExpired(now, ownerToken);
    if (taken == null) {
      return null;
    }

    const operationId = taken._id.toString();
    const { toPath, page } = taken;
    const { grant, descendantCount } = page;
    if (
      toPath != null &&
      isPageGrant(grant) &&
      typeof descendantCount === 'number'
    ) {
      return {
        operation: { operationId, ownerToken },
        fromPath: taken.fromPath,
        toPath,
        userId: taken.user._id.toString(),
        sourceGrant: grant,
        sourceDescendantCount: descendantCount,
        sourceIsEmpty: page.isEmpty === true,
      };
    }

    // A duplicate PageOperation always stores these; it cannot be recovered without them.
    const missingValues = [
      ...(toPath == null ? ['toPath'] : []),
      ...(isPageGrant(grant) ? [] : ['page.grant']),
      ...(typeof descendantCount === 'number' ? [] : ['page.descendantCount']),
    ];
    await PageOperation.deleteOne({ _id: taken._id, ownerToken });
    logger.error(
      { operationId, fromPath: taken.fromPath, missingValues },
      'Deleted a duplicate PageOperation that lacks stored values needed for recovery',
    );
  }
}

/** Deletes the PageOperation only if this process is the owner; throws OwnershipLostError otherwise. */
export async function deleteDuplicatePageOperation(
  operation: OwnedDuplicatePageOperation,
): Promise<void> {
  const result = await PageOperation.deleteOne({
    _id: operation.operationId,
    ownerToken: operation.ownerToken,
  });
  if (result.deletedCount === 0) {
    throw new OwnershipLostError(operation.operationId);
  }
}
