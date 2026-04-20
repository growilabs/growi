/**
 * Tracks per-client activity timestamps and inactivity timers.
 *
 * When a remote client's awareness state changes, the tracker records the
 * timestamp and starts a 3-second inactivity timer. On expiry the supplied
 * callback fires (typically dispatching a decoration rebuild).
 */

const ACTIVITY_TIMEOUT_MS = 3000;

export class ActivityTracker {
  private readonly lastActivityMap = new Map<number, number>();
  private readonly activeTimers = new Map<
    number,
    ReturnType<typeof setTimeout>
  >();

  /** Record activity for a remote client; resets the inactivity timer. */
  recordActivity(clientId: number, now: number, onInactive: () => void): void {
    this.lastActivityMap.set(clientId, now);

    const existing = this.activeTimers.get(clientId);
    if (existing != null) clearTimeout(existing);

    this.activeTimers.set(
      clientId,
      setTimeout(onInactive, ACTIVITY_TIMEOUT_MS),
    );
  }

  /** Clean up tracking state for a disconnected client. */
  removeClient(clientId: number): void {
    this.lastActivityMap.delete(clientId);
    const timer = this.activeTimers.get(clientId);
    if (timer != null) clearTimeout(timer);
    this.activeTimers.delete(clientId);
  }

  /** Whether the client has been active within the last 3 seconds. */
  isActive(clientId: number, now: number): boolean {
    return (
      now - (this.lastActivityMap.get(clientId) ?? 0) < ACTIVITY_TIMEOUT_MS
    );
  }

  /** Clear all timers and state. */
  destroy(): void {
    for (const timer of this.activeTimers.values()) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
    this.lastActivityMap.clear();
  }
}
