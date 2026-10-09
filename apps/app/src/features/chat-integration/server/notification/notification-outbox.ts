// The "書き留める" half of design.md's "通知を2段に分ける" split (Requirements
// 2.1, 2.2, 2.5, 2.6, 12.3). This is task 8.1's own boundary (`NotificationOutbox`)
// -- the OTHER half, actually delivering a row to the proxy and writing the
// result back, is task 8.2's `NotificationDispatcher` and is out of scope here.

import { randomUUID } from 'node:crypto';

import type { ChatNotificationOutboxTarget } from './models/chat-notification-outbox';
import { ChatNotificationOutbox } from './models/chat-notification-outbox';

export interface NotificationOutboxEntry {
  readonly relationId: string;
  readonly targets: ReadonlyArray<ChatNotificationOutboxTarget>;
  readonly markdown: string;
  readonly containsRestrictedPage: boolean;
}

export interface NotificationOutbox {
  /**
   * Called from the page-save processing. **Does not wait for delivery** --
   * design.md's Requirement 2.5 ("通知が失敗してもページ操作は完了させる") requires this
   * to return as soon as the row is written, not once the proxy has been
   * contacted.
   */
  enqueue(entry: NotificationOutboxEntry): Promise<void>;
}

/**
 * The real `NotificationOutbox`, backed by `chat_notification_outbox`
 * (task 1.2's model). `requestId` is minted here, exactly once, with
 * `crypto.randomUUID()` -- and never regenerated afterwards. Task 8.2's
 * `NotificationDispatcher` re-signs and retries against this SAME row/id;
 * it does not call `enqueue` again for a retry (design.md "requestId は行を
 * 作るときに1度だけ採番し、再送しても変えない" -- Requirement 10.4).
 */
export const notificationOutbox: NotificationOutbox = {
  async enqueue(entry) {
    await ChatNotificationOutbox.create({
      requestId: randomUUID(),
      relationId: entry.relationId,
      targets: entry.targets,
      markdown: entry.markdown,
      containsRestrictedPage: entry.containsRestrictedPage,
      state: 'pending',
    });
  },
};
