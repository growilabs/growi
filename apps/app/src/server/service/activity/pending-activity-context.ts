export type PendingActivityContext = {
  ip?: string;
  endpoint?: string;
  userId?: string; // req.user?._id
  username?: string; // req.user?.username → snapshot.username
  createdAt: Date; // request-arrival time; carried to the created row
};

// Process-local map joining the request-time context (known to the middleware
// or the revert flow) with the action determined later by the emit, keyed by
// the pre-minted activity id. The middleware and the listener for a given
// request run in the same process, so a process-local map is sufficient.
//
// Cleanup is event-driven ONLY, performed by callers via take()/clear()
// (middleware path: res 'finish'/'close'; revert path: the error handler of
// the emit-owning async scope). There is deliberately NO time-based TTL sweep
// and NO oldest-entry eviction: such mechanisms would drop entries for slow
// but live requests (minutes-long in-flight operations that have not emitted
// yet) and cause context loss on the recorded row (requirement 2.6
// non-regression). Map size stays naturally bounded by in-flight requests.
const pendingContexts = new Map<string, PendingActivityContext>();

/** Stash request-time context, keyed by the pre-minted activity id. */
export function set(activityId: string, context: PendingActivityContext): void {
  pendingContexts.set(activityId, context);
}

/** Get-and-delete synchronously. Call BEFORE any await in the listener. */
export function take(activityId: string): PendingActivityContext | undefined {
  const context = pendingContexts.get(activityId);
  pendingContexts.delete(activityId);
  return context;
}

/**
 * Idempotent cleanup. Called by the event-driven cleaners:
 *  - middleware path: res 'finish'/'close' (fires regardless of request duration)
 *  - revert path: the error handler of the emit-owning async scope
 * There is deliberately NO time/size-based eviction of live entries.
 */
export function clear(activityId: string): void {
  pendingContexts.delete(activityId);
}
