// The "書き留める" half of design.md's "通知を2段に分ける" split (Requirements
// 2.1, 2.2, 2.5, 2.6, 12.3). Delivering a row is `outbox-dispatcher.ts`'s job.

import { randomUUID } from 'node:crypto';

import type { IntegrationPresence } from '../integration-presence';
import { integrationPresence } from '../integration-presence';
import type { ChatOutboxTarget } from './models/chat-outbox';
import { ChatOutboxRow } from './models/chat-outbox';

export interface NotificationOutboxEntry {
  readonly relationId: string;
  readonly targets: ReadonlyArray<ChatOutboxTarget>;
  readonly markdown: string;
  readonly containsRestrictedPage: boolean;
}

export interface ChatOutbox {
  /**
   * Called from the page-save processing. **Does not wait for delivery** --
   * design.md's Requirement 2.5 ("通知が失敗してもページ操作は完了させる") requires this
   * to return as soon as the row is written, not once the proxy has been
   * contacted.
   */
  enqueue(entry: NotificationOutboxEntry): Promise<void>;
}

export interface ChatOutboxDeps {
  readonly presence?: IntegrationPresence;
}

/**
 * The real `ChatOutbox`, backed by `chat_notification_outbox`
 * (task 1.2's model). `requestId` is minted here, exactly once, with
 * `crypto.randomUUID()` -- and never regenerated afterwards. The outbox
 * dispatcher re-signs and retries against this SAME row/id;
 * it does not call `enqueue` again for a retry (design.md "requestId は行を
 * 作るときに1度だけ採番し、再送しても変えない" -- Requirement 10.4).
 */
export const createChatOutbox = (deps: ChatOutboxDeps = {}): ChatOutbox => {
  const presence = deps.presence ?? integrationPresence;

  return {
    async enqueue(entry) {
      await ChatOutboxRow.create({
        kind: 'notification',
        requestId: randomUUID(),
        relationId: entry.relationId,
        targets: entry.targets,
        markdown: entry.markdown,
        containsRestrictedPage: entry.containsRestrictedPage,
        state: 'pending',
      });
      // Lets this process's dispatch job skip its existence check right away.
      presence.markPresent(new Date());
    },
  };
};

export const chatOutbox: ChatOutbox = createChatOutbox();
