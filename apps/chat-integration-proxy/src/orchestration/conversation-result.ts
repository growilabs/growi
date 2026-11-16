// What the conversation reader returned, as the `ConversationResult` GROWI's
// parser accepts (`@growi/chat`'s parse-conversation.ts). The reader cuts
// nothing, and the parser refuses the whole conversation over one message past
// a limit, so the fitting happens here (design.md AnswerFlow, `readConversation`).
import type {
  ChatAccountRef,
  ConversationMessage,
  ConversationResult,
} from '@growi/chat';

import type { PlatformFacade } from '../platform/index.js';
import type { HistoryMessage } from '../types/index.js';

export type ConversationOutcome = Awaited<
  ReturnType<PlatformFacade['fetchConversation']>
>;

// Copies of the protocol parser's limits, which it does not export;
// `answer-flow.spec.ts` pins each against the parser.
const MESSAGE_MARKDOWN_MAX = 20_000;
const DISPLAY_NAME_MAX = 200;
const ACCOUNT_ID_MAX = 200;

const CUT_MARK = '…';

const isHighSurrogate = (code: number): boolean =>
  code >= 0xd800 && code <= 0xdbff;

/**
 * At most `max` UTF-16 code units -- the unit the parser's `.length` counts --
 * without keeping half of a surrogate pair.
 */
const headOf = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const end = isHighSurrogate(text.charCodeAt(max - 1)) ? max - 1 : max;
  return text.slice(0, end);
};

const markdownOf = (text: string): string =>
  text.length <= MESSAGE_MARKDOWN_MAX
    ? text
    : `${headOf(text, MESSAGE_MARKDOWN_MAX - CUT_MARK.length)}${CUT_MARK}`;

/** The parser requires a name; a service may give none, so the id stands in. */
const authorOf = (author: ChatAccountRef): ChatAccountRef => {
  const accountId = headOf(author.accountId, ACCOUNT_ID_MAX);
  const displayName =
    author.displayName === '' ? accountId : author.displayName;
  return {
    platform: author.platform,
    accountId,
    displayName: headOf(displayName, DISPLAY_NAME_MAX),
  };
};

const messageOf = ({
  postedAt,
  author,
  text,
}: HistoryMessage): ConversationMessage => ({
  postedAt,
  author: authorOf(author),
  markdown: markdownOf(text),
});

/**
 * `range` is counted from the messages handed over, and no message is `empty`
 * (Requirement 5.14). `truncated` stays the reader's: cutting a long message
 * is marked in that message's own text.
 */
export const conversationResultOf = (
  outcome: ConversationOutcome,
): ConversationResult => {
  if (!outcome.ok) {
    return {
      ok: false,
      failure: { reason: outcome.reason, remedy: outcome.remedy },
    };
  }
  const messages = outcome.messages.map(messageOf);
  const first = messages[0];
  const last = messages.at(-1);
  if (first == null || last == null) {
    return { ok: false, failure: { reason: 'empty', remedy: null } };
  }
  return {
    ok: true,
    messages,
    range: {
      messageCount: messages.length,
      firstPostedAt: first.postedAt,
      lastPostedAt: last.postedAt,
    },
    truncated: outcome.truncated,
  };
};
