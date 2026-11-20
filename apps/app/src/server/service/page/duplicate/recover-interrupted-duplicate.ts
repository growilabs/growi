import type { IUserHasId } from '@growi/core';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';
import loggerFactory from '~/utils/logger';

import {
  deleteDuplicatePageOperation,
  type OwnedDuplicatePageOperation,
  OwnershipLostError,
  recordProgress,
  type StalledDuplicatePageOperation,
} from './duplicate-page-operation';
import type { DuplicateDeps } from './duplicate-page-port';
import { notifyDuplicateInterrupted } from './notify-duplicate-interrupted';
import { runDuplicateSubOperation } from './run-duplicate-sub-operation';
import { shouldNormalizeParent } from './should-normalize-parent';

const logger = loggerFactory(
  'growi:services:page:duplicate:recover-interrupted-duplicate',
);

export type InterruptionCause =
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'stalled' };

export interface InterruptedDuplicate {
  readonly operation: OwnedDuplicatePageOperation;
  readonly fromPath: string;
  readonly toPath: string;
  /** PageOperation stores only the user's id, so recovery works from the id alone. */
  readonly userId: string;
  readonly shouldNormalizeParent: boolean;
  /** descendantCount of the source at the start, plus the top page itself */
  readonly sourcePageCount: number;
  readonly cause: InterruptionCause;
}

export type RecoveryOutcome =
  | { readonly status: 'recovered'; readonly copiedPageCount: number }
  | { readonly status: 'ownership-lost' }
  | { readonly status: 'copy-missing' };

const describeTarget = (target: InterruptedDuplicate) => ({
  operationId: target.operation.operationId,
  fromPath: target.fromPath,
  toPath: target.toPath,
  cause: target.cause.kind,
  ...(target.cause.kind === 'error' ? { err: target.cause.error } : {}),
});

/** Turns OwnershipLostError into its outcome; rethrows anything else. */
const ownershipLostOrRethrow = (
  err: unknown,
  target: InterruptedDuplicate,
): RecoveryOutcome => {
  if (!(err instanceof OwnershipLostError)) {
    throw err;
  }
  logger.warn(
    describeTarget(target),
    'Recovery of the duplicate was taken over by another process',
  );
  return { status: 'ownership-lost' };
};

// A user deleted by an admin keeps its document with the deleted status.
const isUserPresent = async (userId: string): Promise<boolean> => {
  const user = await mongoose
    .model<IUserHasId>('User')
    .exists({ _id: userId, status: { $ne: UserStatus.STATUS_DELETED } });
  return user != null;
};

/**
 * Runs the sub operation, deletes the PageOperation, then notifies the
 * duplicating user, in this fixed order (see design.md recoverInterruptedDuplicate).
 * Neither continues the copy nor deletes it.
 *
 * Errors other than OwnershipLostError reject:
 * - before the deletion (e.g. a DB failure in the sub operation), the
 *   PageOperation is kept and recovered again once it expires;
 * - after the deletion (looking up the user or notifying), the PageOperation is
 *   already gone and the notification is lost.
 */
export async function recoverInterruptedDuplicate(
  deps: DuplicateDeps,
  target: InterruptedDuplicate,
): Promise<RecoveryOutcome> {
  const Page = mongoose.model<PageDocument, PageModel>('Page');

  // Looked up the same way as runDuplicateSubOperation, which requires it.
  const copyTopPage = await Page.findOne({ path: target.toPath });
  if (copyTopPage == null) {
    logger.warn(
      describeTarget(target),
      'The copy top page of the interrupted duplicate no longer exists; deleting its PageOperation only',
    );
    try {
      await deleteDuplicatePageOperation(target.operation);
    } catch (err) {
      return ownershipLostOrRethrow(err, target);
    }
    return { status: 'copy-missing' };
  }

  let copiedPageCount: number;
  try {
    ({ copiedPageCount } = await runDuplicateSubOperation(deps, {
      toPath: target.toPath,
      userId: target.userId,
      shouldNormalizeParent: target.shouldNormalizeParent,
      ancestorUpdate: { kind: 'recount' },
      onBatchStart: recordProgress(target.operation),
    }));
  } catch (err) {
    return ownershipLostOrRethrow(err, target);
  }

  try {
    await deleteDuplicatePageOperation(target.operation);
  } catch (err) {
    return ownershipLostOrRethrow(err, target);
  }

  logger.info(
    {
      ...describeTarget(target),
      copiedPageCount,
    },
    'Recovered an interrupted duplicate',
  );

  if (!(await isUserPresent(target.userId))) {
    logger.warn(
      describeTarget(target),
      'The duplicating user no longer exists; skipping the notification',
    );
    return { status: 'recovered', copiedPageCount };
  }

  await notifyDuplicateInterrupted(deps, {
    userId: target.userId,
    copyTopPage,
    fromPath: target.fromPath,
    toPath: target.toPath,
    copiedPageCount,
    sourcePageCount: target.sourcePageCount,
  });
  return { status: 'recovered', copiedPageCount };
}

/** Builds the recovery input from a PageOperation taken over by the cron. */
export function toInterruptedDuplicate(
  stalled: StalledDuplicatePageOperation,
): InterruptedDuplicate {
  return {
    operation: stalled.operation,
    fromPath: stalled.fromPath,
    toPath: stalled.toPath,
    userId: stalled.userId,
    shouldNormalizeParent: shouldNormalizeParent(stalled.sourceGrant),
    sourcePageCount: stalled.sourceDescendantCount + 1,
    cause: { kind: 'stalled' },
  };
}
