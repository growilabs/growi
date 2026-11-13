// Shapes of a conversation read out of a chat service, shared by the answer
// GROWI sends back (`command-answer`) and the conversation the proxy
// hands over on request.

import type { OP_NAMES, RequestEnvelope } from '../endpoints/op-names.js';
import type { ChatAccountRef } from './common.js';

/** What a summary covered: how many messages, and the first and last one's time. */
export interface ConversationRange {
  readonly messageCount: number;
  /** ISO-8601 timestamp. */
  readonly firstPostedAt: string;
  /** ISO-8601 timestamp. */
  readonly lastPostedAt: string;
}

export type ConversationFailureReason =
  | 'not-in-channel'
  | 'not-permitted'
  | 'unsupported'
  | 'rate-limited'
  | 'empty'
  | 'unknown-request';

export interface ConversationFailure {
  readonly reason: ConversationFailureReason;
  /** The operation that would make the history readable. Written by the proxy. */
  readonly remedy: string | null;
}

export interface ConversationMessage {
  /** ISO-8601 timestamp. */
  readonly postedAt: string;
  readonly author: ChatAccountRef;
  readonly markdown: string;
}

/**
 * Names no channel or thread: the proxy looks the place up from its record of
 * the request, so GROWI cannot read an arbitrary conversation.
 */
export interface ConversationRequest extends RequestEnvelope {
  readonly op: typeof OP_NAMES.conversation;
  /** The `requestId` of the original `agent` request. */
  readonly requestId: string;
}

export type ConversationResult =
  | {
      readonly ok: true;
      readonly messages: ReadonlyArray<ConversationMessage>;
      readonly range: ConversationRange;
      /** True when older messages remained unread. */
      readonly truncated: boolean;
    }
  | { readonly ok: false; readonly failure: ConversationFailure };
