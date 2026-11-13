// The answer to an `agent` request, GROWI -> proxy direction. GROWI sends it
// whenever it is ready, however long after the request that was, so the
// proxy never needs a path into GROWI to fetch it (Requirement 15.19).

import type { OP_NAMES, RequestEnvelope } from '../endpoints/op-names.js';
import type { ConversationFailure, ConversationRange } from './conversation.js';

export interface AnswerSource {
  readonly title: string;
  readonly url: string;
}

export type AgentFailureReason =
  | 'timeout'
  | 'agent-error'
  | 'path-conflict'
  | 'forbidden'
  | 'conversation-unavailable';

export type AgentAnswer =
  | {
      readonly kind: 'text';
      readonly markdown: string;
      readonly sources: ReadonlyArray<AnswerSource>;
    }
  | {
      readonly kind: 'page-created';
      readonly pageUrl: string;
      readonly range: ConversationRange;
      /** The service limits how much history is readable, so the range is partial. */
      readonly truncated: boolean;
    }
  | {
      readonly kind: 'failed';
      readonly reason: AgentFailureReason;
      readonly conversationFailure?: ConversationFailure;
    };

export interface CommandAnswerRequest extends RequestEnvelope {
  readonly op: typeof OP_NAMES.commandAnswer;
  /** The `requestId` of the original `agent` request. */
  readonly requestId: string;
  readonly answer: AgentAnswer;
}

/**
 * `delivered`, `undeliverable` and `unknown-request` are final: GROWI must not
 * send the same answer again. Only `in-progress` (and an HTTP failure or
 * timeout) is worth a retry.
 */
export interface CommandAnswerResult {
  readonly status:
    | 'delivered'
    | 'undeliverable'
    | 'unknown-request'
    | 'in-progress';
}
