// The "書き留める" half of design.md's "通知を2段に分ける" split (Requirements
// 2.1, 2.2, 2.5, 2.6, 2.10, 12.3). Delivering a row is `outbox-dispatcher.ts`'s
// job; writing one also asks it to start right away.

import { randomUUID } from 'node:crypto';
import type { AgentAnswer } from '@growi/chat';

import type { IntegrationPresence } from '../integration-presence';
import { integrationPresence } from '../integration-presence';
import { outboxDispatcher } from './deliverers';
import type { ChatOutboxTarget } from './models/chat-outbox';
import { ChatOutboxRow } from './models/chat-outbox';
import type { OutboxDispatcher } from './outbox-dispatcher';

export interface NotificationOutboxEntry {
  readonly kind: 'notification';
  readonly relationId: string;
  readonly targets: ReadonlyArray<ChatOutboxTarget>;
  readonly markdown: string;
  readonly containsRestrictedPage: boolean;
}

export interface CommandAnswerOutboxEntry {
  readonly kind: 'command-answer';
  readonly relationId: string;
  /** The `requestId` of the request this answers, not a new one. */
  readonly requestId: string;
  readonly answer: AgentAnswer;
}

export type OutboxEntry = NotificationOutboxEntry | CommandAnswerOutboxEntry;

export interface ChatOutbox {
  /**
   * Write the entry down and ask the dispatcher to send it. **Resolves once
   * the row is written, not once it is sent** -- Requirement 2.5 ("通知が失敗
   * してもページ操作は完了させる"), and a failed send never reaches the caller.
   */
  enqueue(entry: OutboxEntry): Promise<void>;
}

export interface ChatOutboxDeps {
  readonly presence?: IntegrationPresence;
  readonly dispatcher?: OutboxDispatcher;
}

/**
 * A notification's `requestId` is minted here, exactly once, and never
 * regenerated: a retry re-sends the SAME row (Requirement 10.4). A command
 * answer reuses the `requestId` of the request it answers.
 */
const rowFor = (entry: OutboxEntry) =>
  entry.kind === 'notification'
    ? {
        kind: entry.kind,
        requestId: randomUUID(),
        relationId: entry.relationId,
        targets: entry.targets,
        markdown: entry.markdown,
        containsRestrictedPage: entry.containsRestrictedPage,
      }
    : {
        kind: entry.kind,
        requestId: entry.requestId,
        relationId: entry.relationId,
        answer: entry.answer,
      };

export const createChatOutbox = (deps: ChatOutboxDeps = {}): ChatOutbox => {
  const presence = deps.presence ?? integrationPresence;
  const dispatcher = deps.dispatcher ?? outboxDispatcher;

  return {
    async enqueue(entry) {
      await ChatOutboxRow.create({ ...rowFor(entry), state: 'pending' });
      // Lets this process's dispatch job skip its existence check right away.
      presence.markPresent(new Date());
      void dispatcher.requestDrain();
    },
  };
};

export const chatOutbox: ChatOutbox = createChatOutbox();
