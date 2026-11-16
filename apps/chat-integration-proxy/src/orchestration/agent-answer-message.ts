// What the requester reads when GROWI's answer to an `agent` request arrives
// (design.md's AgentAnswerMessage). Pure: the platform layer renders the
// markdown for each service, so nothing here depends on which one it is.
import type {
  AgentAnswer,
  AgentFailureReason,
  ConversationFailure,
  ConversationFailureReason,
  ConversationRange,
} from '@growi/chat';

import type { ContinuePlace } from '../capabilities/index.js';
import type { OutboundMessage } from '../types/index.js';
import { markdown } from './growi-reply-wording.js';

export type AnswerPlace = 'channel' | 'direct';

export interface AnswerMessageContext {
  /** Where the request was made. */
  readonly place: AnswerPlace;
  /** Where the service lets the person carry on; `CONTINUE_PLACE[platform]`. */
  readonly continuePlace: ContinuePlace;
}

// Same set `platform/outbound.ts` encodes: the characters that end or split a
// markdown link.
const LINK_BREAKING = /[ |()[\]<>`]/g;
const encodeLinkUrl = (url: string): string =>
  url.replace(
    LINK_BREAKING,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const escapeLinkLabel = (label: string): string =>
  label.replace(/\s+/g, ' ').replace(/[\\[\]]/g, (char) => `\\${char}`);

const sourceLine = ({
  title,
  url,
}: {
  readonly title: string;
  readonly url: string;
}): string => {
  const label = title.trim() === '' ? url : title;
  return `- [${escapeLinkLabel(label)}](${encodeLinkUrl(url)})`;
};

const CONTINUE_NOTICE =
  'この続きは、bot との DM で聞けます。DM の同じスレッドで続けて依頼すると、それまでのやり取りを踏まえて答えます。';

const textMessage = (
  answer: Extract<AgentAnswer, { kind: 'text' }>,
  context: AnswerMessageContext,
): string =>
  [
    answer.markdown,
    answer.sources.length === 0
      ? null
      : ['出典:', ...answer.sources.map(sourceLine)].join('\n'),
    context.place === 'channel' && context.continuePlace === 'direct-message'
      ? CONTINUE_NOTICE
      : null,
  ]
    .filter((part) => part != null)
    .join('\n\n');

// The proxy does not know the reader's time zone, so the time is stated in UTC
// rather than guessed. A value that is not a date is shown as written.
const timeOf = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};

const rangeLine = (range: ConversationRange): string =>
  `要約した範囲: ${timeOf(range.firstPostedAt)} から ${timeOf(range.lastPostedAt)}、${range.messageCount} 件`;

const pageCreatedMessage = (
  answer: Extract<AgentAnswer, { kind: 'page-created' }>,
): string =>
  [
    `会話を要約したページを作りました: <${encodeLinkUrl(answer.pageUrl)}>`,
    rangeLine(answer.range),
    answer.truncated
      ? '読めた範囲だけを要約しています。会話の全部は読めていません。'
      : null,
  ]
    .filter((part) => part != null)
    .join('\n');

const CONVERSATION_FAILURE_SENTENCES: Readonly<
  Record<ConversationFailureReason, string>
> = {
  'not-in-channel':
    '会話を読めませんでした。bot がこの場所に参加していません。',
  'not-permitted':
    '会話を読めませんでした。bot に会話の履歴を読む権限がありません。',
  unsupported:
    'この場所の会話の履歴は、このチャットサービスでは読めないため、要約できません。',
  'rate-limited':
    'チャットサービスの制限で、会話の履歴を読めませんでした。時間を置いて、もう一度依頼してください。',
  empty: '要約する発言が 1 件もないため、ページは作っていません。',
  'unknown-request':
    '会話を読む元の依頼が見つかりませんでした。もう一度依頼してください。',
};

const UNKNOWN_CONVERSATION_FAILURE =
  '会話を読めませんでした。時間を置いて、もう一度依頼してください。';

const conversationFailureMessage = (
  failure: ConversationFailure | undefined,
): string =>
  failure == null
    ? UNKNOWN_CONVERSATION_FAILURE
    : [CONVERSATION_FAILURE_SENTENCES[failure.reason], failure.remedy]
        .filter((part) => part != null)
        .join('\n');

const FAILURE_SENTENCES: Readonly<
  Record<Exclude<AgentFailureReason, 'conversation-unavailable'>, string>
> = {
  timeout:
    '答えの作成に時間がかかりすぎたため、中止しました。時間を置いて、もう一度依頼してください。',
  'agent-error':
    '答えを作る途中でエラーが起きました。時間を置いて、もう一度依頼してください。',
  'path-conflict':
    '同じパスにページが既にあるため、要約のページを作れませんでした。別のパスを指定して、もう一度依頼してください。',
  forbidden:
    'そのパスにページを作る権限がないため、要約のページを作れませんでした。別のパスを指定するか、権限を持つ人に依頼してください。',
};

const failedMessage = (
  answer: Extract<AgentAnswer, { kind: 'failed' }>,
): string =>
  answer.reason === 'conversation-unavailable'
    ? conversationFailureMessage(answer.conversationFailure)
    : FAILURE_SENTENCES[answer.reason];

export const agentAnswerMessage = (
  answer: AgentAnswer,
  context: AnswerMessageContext,
): OutboundMessage => {
  switch (answer.kind) {
    case 'text':
      return markdown(textMessage(answer, context));
    case 'page-created':
      return markdown(pageCreatedMessage(answer));
    case 'failed':
      return markdown(failedMessage(answer));
  }
};
