import { randomUUID } from 'node:crypto';
import { PageGrant } from '@growi/core';
import { Types } from 'mongoose';

import { PageActionStage, PageActionType } from '~/interfaces/page-operation';
import type { PageDocument } from '~/server/models/page';
import PageOperation, {
  type PageOperationDocument,
} from '~/server/models/page-operation';

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

const toStalledDuplicatePageOperation = (
  doc: PageOperationDocument,
  ownerToken: string,
): StalledDuplicatePageOperation => {
  const operationId = doc._id.toString();
  const { toPath } = doc;
  const { grant, descendantCount } = doc.page;
  // A duplicate PageOperation always stores these; a missing one is corrupted data.
  if (
    toPath == null ||
    !isPageGrant(grant) ||
    typeof descendantCount !== 'number'
  ) {
    throw new Error(
      `Duplicate PageOperation ${operationId} lacks toPath, page.grant or page.descendantCount`,
    );
  }
  return {
    operation: { operationId, ownerToken },
    fromPath: doc.fromPath,
    toPath,
    userId: doc.user._id.toString(),
    sourceGrant: grant,
    sourceDescendantCount: descendantCount,
  };
};

/** Atomically takes over one PageOperation judged expired by lastProgressAt. */
export async function takeOverStalledDuplicate(
  now: Date,
): Promise<StalledDuplicatePageOperation | null> {
  const stalledBefore = new Date(now.getTime() - STALL_THRESHOLD_MS);
  // ObjectId timestamps have second precision; createFromTime takes seconds.
  const legacyCreatedBefore = Types.ObjectId.createFromTime(
    Math.floor((now.getTime() - LEGACY_RECORD_MIN_AGE_MS) / 1000),
  );
  const ownerToken = randomUUID();

  const taken = await PageOperation.findOneAndUpdate(
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
    { new: true },
  );
  if (taken == null) {
    return null;
  }
  return toStalledDuplicatePageOperation(taken, ownerToken);
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
