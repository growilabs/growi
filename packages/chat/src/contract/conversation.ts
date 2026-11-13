// Shapes of a conversation read out of a chat service, shared by the answer
// the GROWI sends back (`command-answer`) and the conversation the proxy
// hands over on request.

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
