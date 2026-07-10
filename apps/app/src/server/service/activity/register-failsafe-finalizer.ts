import type { Response } from 'express';

import type { PendingActivityContext } from './pending-activity-context';
import * as pendingActivityContext from './pending-activity-context';
import { recordFailsafeAttempt } from './record-failsafe-attempt';

/**
 * Wire the two `res` events that can end a request without the normal
 * settle path ever running (the route handler returned an error response,
 * or the client disconnected mid-request), so that:
 *   - a failed/interrupted attempt still leaves one ACTION_UNSETTLED audit
 *     row (via recordFailsafeAttempt), and
 *   - the pending-context map entry for this request is always removed
 *     (via pendingActivityContext.clear), regardless of how the request
 *     ended.
 *
 * This is the SOLE owner of the failure-detection logic (the statusCode /
 * writableFinished thresholds) -- the middleware that calls this must not
 * carry its own copy (requirement 4.1; design.md: Service / fail-safe >
 * registerFailsafeFinalizer).
 *
 * - `res.on('finish', ...)`: fires whenever the response finished being
 *   sent, success or error alike. Only `statusCode >= 400` counts as a
 *   failure worth recording; a successful completion (< 400) records
 *   nothing.
 * - `res.on('close', ...)`: fires whenever the underlying connection
 *   closes. `writableFinished === false` at that point means the response
 *   never finished writing -- a true client interruption -- and is the only
 *   'close' case that records an attempt. A normal response also emits
 *   'close' after 'finish', but by then `writableFinished` is already
 *   `true`, so it records nothing (recordFailsafeAttempt is idempotent via
 *   duplicate-key absorption, but this keeps the common case a no-op).
 *
 * Cleanup runs unconditionally at the end of both handlers, right after the
 * (possibly skipped) attempt call -- not inside a `.then()`/`.catch()` of
 * it. recordFailsafeAttempt is itself best-effort and never rejects (see
 * its own doc comment), so there is nothing for a handler-level try/finally
 * to guard against; sequencing the calls is sufficient to guarantee `clear`
 * always runs once per event, matching the event-driven, deterministic
 * cleanup the design requires (no time/size-based sweep -- see design.md
 * Error Handling: 長時間リクエストの誤 sweep).
 *
 * @param res the response to instrument; the caller keeps ownership -- this
 * function only attaches listeners
 * @param activityId the pre-minted id this request's pending context is
 * keyed by (see beginActivity)
 * @param context the request-time context to pass through to
 * recordFailsafeAttempt if the request turns out to have failed/interrupted
 */
export function registerFailsafeFinalizer(
  res: Response,
  activityId: string,
  context: PendingActivityContext,
): void {
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      void recordFailsafeAttempt(activityId, context);
    }
    pendingActivityContext.clear(activityId);
  });

  res.on('close', () => {
    if (!res.writableFinished) {
      void recordFailsafeAttempt(activityId, context);
    }
    pendingActivityContext.clear(activityId);
  });
}
