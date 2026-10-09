/**
 * A Gen 2 notification destination. Deliberately NOT typed with `@growi/chat`'s
 * `PlatformName` union here -- `DestinationRegistry` must stay generic over
 * `platform` (Requirement 12.2/12.3, design.md "宛先の集合を種類で分岐しない"),
 * so its own code must never need to know the closed set of valid platforms.
 * Callers that DO know the valid set (e.g. reading from `ChatNotificationDestination`)
 * narrow to `PlatformName` at their own boundary.
 */
export interface Gen2Destination {
  /**
   * Which relation this destination's channel belongs to. Required (not
   * task 2.3's original scope) because task 8.1's real dispatch writes a
   * `chat_notification_outbox` row scoped to one relation
   * (`NotificationOutbox.enqueue` -- design.md "通知を2段に分ける") --
   * without it, a destination could not be routed to the right relation's
   * outbox row.
   */
  readonly relationId: string;
  readonly platform: string;
  readonly channelId: string;
}

export type DestinationDispatchOutcome = 'dispatched' | 'failed';

export interface DestinationDispatchResult {
  readonly destination: Gen2Destination;
  readonly outcome: DestinationDispatchOutcome;
}

/**
 * Delivers to one destination. Task 2.3 wires only the iteration point --
 * the real implementation (writing into `NotificationOutbox` and draining it
 * to the proxy) is task 8.1/8.2's `NotificationOutbox`/`NotificationDispatcher`
 * boundary, not this one.
 */
export type DestinationDispatcher = (
  destination: Gen2Destination,
) => Promise<void>;

/**
 * A set of Gen 2 destinations, dispatched to generically.
 *
 * This is the ONLY way Gen 2 destinations are contacted from Gen 1's
 * notification call sites (`global-notification`, `user-notification`) --
 * those call sites add a call into this registry alongside their existing,
 * unmodified Gen 1 send logic, rather than branching on destination type
 * themselves (design.md "宛先の集合を種類で分岐しない" -- Requirement 12.2, 12.3).
 *
 * A destination failing to dispatch does not stop the others: this class
 * awaits every destination concurrently and reports each outcome
 * individually, rather than following `Promise.all`'s fail-fast semantics
 * (the same pitfall this spec's design.md identifies in Gen 1's existing
 * `Promise.all` call sites).
 */
export class DestinationRegistry {
  private readonly destinations: readonly Gen2Destination[];

  constructor(destinations: readonly Gen2Destination[]) {
    this.destinations = destinations;
  }

  get size(): number {
    return this.destinations.length;
  }

  async dispatchAll(
    dispatch: DestinationDispatcher,
  ): Promise<DestinationDispatchResult[]> {
    return Promise.all(
      this.destinations.map(async (destination) => {
        try {
          await dispatch(destination);
          return { destination, outcome: 'dispatched' as const };
        } catch {
          return { destination, outcome: 'failed' as const };
        }
      }),
    );
  }
}
