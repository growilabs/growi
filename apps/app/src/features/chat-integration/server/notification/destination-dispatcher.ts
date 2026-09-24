import type { PlatformName } from '@growi/chat';

import type { DestinationDispatcher } from './destination-registry';
import type { NotificationOutbox } from './notification-outbox';
import { notificationOutbox } from './notification-outbox';

/**
 * The real Gen 2 destination dispatcher -- replaces task 2.3's placeholder
 * ("受け側は仮のものでよい" -- design.md task 2.3, deferred to task 8.1's
 * `NotificationOutbox` boundary).
 *
 * Writes ONE `chat_notification_outbox` row per destination it is called
 * with (scoped to that destination's own `relationId`), rather than
 * batching every destination that shares a relation into a single row.
 * `DestinationRegistry.dispatchAll` is what makes "repeat this call for
 * every relevant destination, never stop after one" hold (design.md
 * "呼ぶ側が関係ごとに繰り返す") -- this factory itself only knows how to
 * enqueue a single destination; see this module's CONCERNS note in the
 * task 8.1 status report for why per-destination rows (not per-relation
 * batching) were chosen here.
 *
 * `markdown`/`containsRestrictedPage` are closed over per notification
 * event, since `DestinationDispatcher`'s signature carries only the
 * destination itself -- `NotificationContent` (task 4.5) has already
 * finished dropping a restricted page's body into `markdown` by the time
 * this runs (design.md "文面は NotificationContent が作る").
 */
export const createGen2NotificationDispatcher = (
  markdown: string,
  containsRestrictedPage: boolean,
  outbox: NotificationOutbox = notificationOutbox,
): DestinationDispatcher => {
  return async (destination) => {
    await outbox.enqueue({
      relationId: destination.relationId,
      // `Gen2Destination.platform` is deliberately typed as a bare `string`
      // (destination-registry.ts) so this module stays agnostic of the
      // closed platform set; the outbox schema itself is what constrains
      // `platform` to `PlatformName`, so the cast happens here, at the one
      // boundary that actually needs the narrower type.
      targets: [
        {
          platform: destination.platform as PlatformName,
          channelId: destination.channelId,
        },
      ],
      markdown,
      containsRestrictedPage,
    });
  };
};
