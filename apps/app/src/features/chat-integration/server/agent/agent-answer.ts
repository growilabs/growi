// Turning what a run produced into the `AgentAnswer` the proxy accepts
// (design.md CommandAnswerContract). The proxy refuses a whole answer that
// breaks one of its bounds, and a refused answer is never retried into
// success, so every value is brought inside the bounds here.

import type {
  AgentAnswer,
  AgentFailureReason,
  AnswerSource,
  ConversationFailure,
  ConversationMessage,
} from '@growi/chat';
import urljoin from 'url-join';

import type { AnswerResult } from './growi-ai-gateway-types';

// Bounds of `parseCommandAnswerRequest` (packages/chat parse-command-answer.ts).
const MARKDOWN_MAX = 30_000;
const SOURCES_MAX = 20;
const SOURCE_TITLE_MAX = 500;
const SOURCE_URL_MAX = 2000;

const CUT_NOTE =
  '\n\n…(This answer was cut short because it is too long for chat.)';

export const failedAnswer = (
  reason: AgentFailureReason,
  conversationFailure?: ConversationFailure,
): AgentAnswer =>
  conversationFailure == null
    ? { kind: 'failed', reason }
    : { kind: 'failed', reason, conversationFailure };

/** Cuts to at most `max` UTF-16 units without splitting a surrogate pair. */
const cutTo = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const lastKept = text.charCodeAt(max - 1);
  const splitsPair = lastKept >= 0xd800 && lastKept <= 0xdbff;
  return text.slice(0, splitsPair ? max - 1 : max);
};

const boundedMarkdown = (markdown: string): string =>
  markdown.length <= MARKDOWN_MAX
    ? markdown
    : `${cutTo(markdown, MARKDOWN_MAX - CUT_NOTE.length)}${CUT_NOTE}`;

const boundedSources = (sources: ReadonlyArray<AnswerSource>): AnswerSource[] =>
  sources
    .filter(
      ({ title, url }) =>
        title !== '' && url !== '' && url.length <= SOURCE_URL_MAX,
    )
    .slice(0, SOURCES_MAX)
    .map(({ title, url }) => ({ title: cutTo(title, SOURCE_TITLE_MAX), url }));

/** An empty answer is not sendable (the protocol requires a non-empty text). */
export const textAnswerOf = ({
  markdown,
  sources,
}: AnswerResult): AgentAnswer =>
  markdown.trim() === ''
    ? failedAnswer('agent-error')
    : {
        kind: 'text',
        markdown: boundedMarkdown(markdown),
        sources: boundedSources(sources),
      };

/**
 * Links by page id: a memo-area path contains spaces, which would end the
 * link early in chat. `messages` is non-empty; the proxy's own count is not
 * trusted.
 */
export const pageCreatedAnswerOf = (params: {
  readonly siteUrl: string;
  readonly pageId: string;
  readonly messages: ReadonlyArray<ConversationMessage>;
  readonly truncated: boolean;
}): AgentAnswer => {
  const { siteUrl, pageId, messages, truncated } = params;
  return {
    kind: 'page-created',
    pageUrl: urljoin(siteUrl, pageId),
    range: {
      messageCount: messages.length,
      firstPostedAt: messages[0].postedAt,
      lastPostedAt: messages[messages.length - 1].postedAt,
    },
    truncated,
  };
};
