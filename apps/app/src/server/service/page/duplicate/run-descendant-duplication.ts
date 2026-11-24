import type { IUserHasId } from '@growi/core';

import type { PageDocument } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import { BULK_REINDEX_SIZE } from '../consts';
import { PageCursorsForDescendantsFactory } from '../page-cursors-for-descendants';
import { shouldNormalizeParent } from '../should-normalize-parent';
import { copyDescendantBatch } from './copy-descendant-batch';
import {
  deleteDuplicatePageOperation,
  type OwnedDuplicatePageOperation,
  OwnershipLostError,
  recordProgress,
} from './duplicate-page-operation';
import type { DuplicateDeps } from './duplicate-page-port';
import {
  countSourcePages,
  recoverInterruptedDuplicate,
} from './recover-interrupted-duplicate';
import { runDuplicateSubOperation } from './run-duplicate-sub-operation';

const logger = loggerFactory(
  'growi:services:page:duplicate:run-descendant-duplication',
);

export interface DescendantDuplicationInput {
  readonly operation: OwnedDuplicatePageOperation;
  readonly sourcePage: PageDocument;
  readonly newPagePath: string;
  readonly user: IUserHasId;
  readonly onlyDuplicateUserRelatedResources: boolean;
}

async function* inBatches<T>(
  items: AsyncIterable<T> | Iterable<T>,
  size: number,
): AsyncGenerator<T[]> {
  let batch: T[] = [];
  for await (const item of items) {
    batch.push(item);
    if (batch.length >= size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) {
    yield batch;
  }
}

/** Copies the descendants batch by batch, then runs the sub operation and deletes the PageOperation. */
async function duplicateDescendants(
  deps: DuplicateDeps,
  input: DescendantDuplicationInput,
): Promise<void> {
  const { operation, sourcePage, newPagePath, user } = input;
  const progress = recordProgress(operation);

  // Empty pages are read too, so that descendants under them are reached.
  const descendants = await new PageCursorsForDescendantsFactory(
    user,
    sourcePage,
    true,
  ).generateIterable();
  // in-process only (never sent to MongoDB), so RegExp.escape is safe here
  const oldPathPrefix = new RegExp(`^${RegExp.escape(sourcePage.path)}`, 'i');

  let insertedPageCount = 0;
  for await (const pages of inBatches<PageDocument>(
    descendants,
    BULK_REINDEX_SIZE,
  )) {
    // A batch may write nothing, and so record no progress on its own.
    await progress();
    const result = await copyDescendantBatch(deps, {
      pages,
      oldPathPrefix,
      newPathPrefix: newPagePath,
      user,
      onlyDuplicateUserRelatedResources:
        input.onlyDuplicateUserRelatedResources,
      recordProgress: progress,
    });
    insertedPageCount += result.insertedPageCount;
  }

  await runDuplicateSubOperation(deps, {
    toPath: newPagePath,
    userId: user._id.toString(),
    shouldNormalizeParent: shouldNormalizeParent(sourcePage.grant),
    ancestorUpdate: { kind: 'increment', insertedPageCount },
    onBatchStart: progress,
  });
  // Kept last: a failure here still reaches the recovery, and once the
  // PageOperation is gone there is nothing left to recover.
  await deleteDuplicatePageOperation(operation);

  logger.info(
    { operationId: operation.operationId, insertedPageCount },
    `Duplicated the descendants of "${sourcePage.path}" to "${newPagePath}"`,
  );
}

async function handOverToRecovery(
  deps: DuplicateDeps,
  input: DescendantDuplicationInput,
  error: unknown,
): Promise<void> {
  const { operation, sourcePage, newPagePath, user } = input;
  const context = {
    operationId: operation.operationId,
    fromPath: sourcePage.path,
    toPath: newPagePath,
  };

  if (error instanceof OwnershipLostError) {
    // The process that took the PageOperation over deletes it and notifies.
    logger.warn(
      { ...context, err: error },
      'The duplicate was taken over by another process; stopping without writing',
    );
    return;
  }

  logger.error(
    { ...context, err: error },
    'Duplicating descendants failed; recovering the partial copy',
  );
  try {
    await recoverInterruptedDuplicate(deps, {
      operation,
      fromPath: sourcePage.path,
      toPath: newPagePath,
      userId: user._id.toString(),
      shouldNormalizeParent: shouldNormalizeParent(sourcePage.grant),
      sourcePageCount: countSourcePages(
        sourcePage.descendantCount,
        sourcePage.isEmpty,
      ),
      cause: { kind: 'error', error },
    });
  } catch (recoveryError) {
    // The PageOperation is kept (unless deleted already) and the cron recovers it once expired.
    logger.error(
      { ...context, err: recoveryError },
      'Failed to recover the interrupted duplicate',
    );
  }
}

/**
 * Duplicates the descendants of a v5 page (see design.md runDescendantDuplication).
 * Never rejects: a failure is handed to recoverInterruptedDuplicate in place,
 * since the caller starts this without awaiting it.
 */
export async function runDescendantDuplication(
  deps: DuplicateDeps,
  input: DescendantDuplicationInput,
): Promise<void> {
  try {
    await duplicateDescendants(deps, input);
  } catch (err) {
    await handOverToRecovery(deps, input, err);
  }
}
