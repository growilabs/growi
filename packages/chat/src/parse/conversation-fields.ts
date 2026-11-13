// Field checkers for `ConversationRange` and `ConversationFailure`, shared by
// `parseCommandAnswerRequest` and the conversation endpoint's parsers. NOT
// part of any public barrel, like `common-fields.ts`.

import type {
  ConversationFailure,
  ConversationRange,
} from '../contract/conversation.js';
import { isRecord, oneOf, str } from './shape.js';

/** A conversation read is at most 200 messages (design.md ConversationContract). */
const MESSAGE_COUNT_MAX = 200;
const POSTED_AT_MAX = 64;
const REMEDY_MAX = 500;

const FAILURE_REASONS = [
  'not-in-channel',
  'not-permitted',
  'unsupported',
  'rate-limited',
  'empty',
  'unknown-request',
] as const;

export const parseConversationRange = (
  v: unknown,
): ConversationRange | undefined => {
  if (!isRecord(v)) {
    return undefined;
  }

  const { messageCount } = v;
  const firstPostedAt = str(v.firstPostedAt, POSTED_AT_MAX);
  const lastPostedAt = str(v.lastPostedAt, POSTED_AT_MAX);

  if (
    typeof messageCount !== 'number' ||
    !Number.isInteger(messageCount) ||
    messageCount < 1 ||
    messageCount > MESSAGE_COUNT_MAX ||
    firstPostedAt === undefined ||
    lastPostedAt === undefined
  ) {
    return undefined;
  }

  return { messageCount, firstPostedAt, lastPostedAt };
};

export const parseConversationFailure = (
  v: unknown,
): ConversationFailure | undefined => {
  if (!isRecord(v)) {
    return undefined;
  }

  const reason = oneOf(v.reason, FAILURE_REASONS);
  // `null` means the proxy has no operation to suggest; absent is not the same
  // thing and is refused.
  const remedy = v.remedy === null ? null : str(v.remedy, REMEDY_MAX);

  if (reason === undefined || remedy === undefined) {
    return undefined;
  }

  return { reason, remedy };
};
