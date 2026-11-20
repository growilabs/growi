import { Prisma } from '~/generated/prisma/client';
import { SupportedAction } from '~/interfaces/activity';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type { PendingActivityContext } from './pending-activity-context';

const logger = loggerFactory('growi:service:activity:record-failsafe-attempt');

/**
 * Create exactly one ACTION_UNSETTLED "attempt was made" row for a request
 * that ended in failure or interruption before record-eligibility could be
 * determined (called only by registerFailsafeFinalizer, after it has
 * already decided the request failed/aborted).
 *
 * No pre-read: the pre-minted `activityId` is the row's primary key, so if
 * settle already created the real-action row for this id, `create` fails
 * with a duplicate-key error (Prisma P2002 -- verified against the real DB
 * in record-failsafe-attempt.integ.ts), which is swallowed here as benign.
 * Deliberately does NOT call `findFirst`/any existence check first -- that
 * would add a read to the failure path, which the design explicitly avoids
 * (Issue 1; design.md: Service / fail-safe > recordFailsafeAttempt).
 *
 * Best-effort: never rejects. A non-duplicate-key failure is logged via
 * `logger.error` and swallowed too -- the request is already ending, and a
 * failed audit write must not affect it (design.md Error Handling: finalizer
 * の作成失敗).
 *
 * Requirements: 4.1, 4.2, 4.3
 */
export async function recordFailsafeAttempt(
  activityId: string,
  context: PendingActivityContext,
): Promise<void> {
  try {
    await prisma.activities.createByParameters({
      id: activityId,
      action: SupportedAction.ACTION_UNSETTLED,
      ip: context.ip,
      endpoint: context.endpoint,
      createdAt: context.createdAt,
      // Map context onto the shape createByParameters actually consumes
      // (models/activity.ts): operator id -> `user`, operator name ->
      // `snapshot.username` -- never top-level `userId`/`username`
      // (Implementation Note 2; a stray top-level `username` makes Prisma
      // `create` throw, since `activities` has no such column).
      user: context.userId,
      snapshot: { username: context.username },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      // Benign: settle already created the real-action row for this id
      // (Issue 1 -- the rare race the design accepts). Nothing to log; this
      // is the expected/designed outcome, not a failure.
      return;
    }
    logger.error('Failed to record failsafe attempt', err);
  }
}
