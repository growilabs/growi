// Confirms the wire shape of a signed `ConversationRequest` and of the
// proxy's `ConversationResult` (Requirement 10.1). See parse-command.ts's
// header comment for why every parse* function re-checks shape even though the
// body already passed signature verification.

import type {
  ConversationMessage,
  ConversationRequest,
  ConversationResult,
} from '../contract/conversation.js';
import { OP_NAMES } from '../endpoints/op-names.js';
import { parseChatAccountRef } from './common-fields.js';
import {
  parseConversationFailure,
  parseConversationRange,
} from './conversation-fields.js';
import { arr, isRecord, oneOf, str } from './shape.js';

const RELATION_ID_MAX = 128;
const REQUEST_ID_MAX = 128;
// Limits from design.md's ConversationContract: at most 200 messages, and a
// message of at most 20,000 characters (the same as a `keep` message).
const MESSAGES_MAX = 200;
const MESSAGE_MARKDOWN_MAX = 20_000;
// Not in design.md; same bound as `ConversationRange`'s timestamps.
const POSTED_AT_MAX = 64;

type ParseError = { readonly error: 'malformed' };

const parseMessage = (v: unknown): ConversationMessage | undefined => {
  if (!isRecord(v)) {
    return undefined;
  }

  const postedAt = str(v.postedAt, POSTED_AT_MAX);
  const author = parseChatAccountRef(v.author);
  // Checked by hand, not via `str`: an attachment-only post has an empty body
  // (see KEEP_MARKDOWN_MAX in parse-command.ts).
  const { markdown } = v;

  return postedAt === undefined ||
    author === undefined ||
    typeof markdown !== 'string' ||
    markdown.length > MESSAGE_MARKDOWN_MAX
    ? undefined
    : { postedAt, author, markdown };
};

export const parseConversationRequest = (
  raw: unknown,
): ConversationRequest | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const relationId = str(raw.relationId, RELATION_ID_MAX);
  const op = oneOf(raw.op, [OP_NAMES.conversation]);
  const requestId = str(raw.requestId, REQUEST_ID_MAX);

  if (relationId === undefined || op === undefined || requestId === undefined) {
    return { error: 'malformed' };
  }

  return { relationId, op, requestId };
};

export const parseConversationResult = (
  raw: unknown,
): ConversationResult | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  if (raw.ok === false) {
    const failure = parseConversationFailure(raw.failure);
    return failure === undefined
      ? { error: 'malformed' }
      : { ok: false, failure };
  }

  if (raw.ok !== true) {
    return { error: 'malformed' };
  }

  const messages = arr(raw.messages, MESSAGES_MAX, parseMessage);
  const range = parseConversationRange(raw.range);
  const { truncated } = raw;

  if (
    messages === undefined ||
    range === undefined ||
    typeof truncated !== 'boolean'
  ) {
    return { error: 'malformed' };
  }

  return { ok: true, messages, range, truncated };
};
