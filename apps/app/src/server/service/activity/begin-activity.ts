import { Types } from 'mongoose';

import type { PendingActivityContext } from './pending-activity-context';
import * as pendingActivityContext from './pending-activity-context';

/**
 * Mint an activity id and stash the request-time context, keyed by that id.
 *
 * This is the ONLY implementation of mint+stash: both the add-activity
 * middleware and the revert flow (revertDeletedPage) call this, so future
 * recording paths that bypass the middleware only need to call it too
 * (requirement 3.3 — no duplicated mint+stash logic).
 *
 * Deliberately independent of the recording gate, failure detection, `res`,
 * notifications, and contribution: it touches neither the DB nor `res`.
 * `Types.ObjectId` mints the id purely in-process (no connection needed).
 *
 * @param context request-time context; must carry the arrival time `createdAt`
 * @returns the pre-minted id to expose as the Activity `_id`
 */
export function beginActivity(context: PendingActivityContext): {
  activityId: string;
} {
  const activityId = new Types.ObjectId().toString();
  pendingActivityContext.set(activityId, context);
  return { activityId };
}
