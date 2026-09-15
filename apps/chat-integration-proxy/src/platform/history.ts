// design.md's File Structure Plan for this file: `fetchHistory` -- the
// conversation history a `keep` command turns into a page (Requirement 5.1 /
// 5.2), bounded by the `TimeRange` the user chose.
//
// Three things shape the implementation:
//
//  1. **A channel's own messages, not a thread's replies.** The SDK offers
//     both, and they answer different questions: `fetchMessages(threadId)`
//     walks the replies under one message, while `fetchChannelMessages`
//     (Slack's own comment: 「channel-level messages (conversations.history,
//     not thread replies)」) walks the conversation. `fetchHistory` takes a
//     `ChannelRef`, so it is the latter.
//  2. **No service can be asked for a time range**, only for a page and a
//     direction (`FetchOptions` carries `limit` / `cursor` / `direction` and
//     nothing else). So the range is applied here: pages are walked from the
//     newest backwards and the walk stops as soon as a page reaches back past
//     the start of the range.
//  3. **A failure the reader can act on is told apart from one they cannot.**
//     Requirement 5.4 asks for 「取得できない理由と、取得できるようにするために
//     必要な操作」, which is exactly `HistoryOutcome`'s `reason` plus `remedy`.
//     The recognition of *which* failure it is comes from `outbound.ts`, so
//     there is one answer for the whole layer rather than a second copy here
//     that can drift.
import type { ChannelRef } from '@growi/chat';
import type { Adapter, FetchResult, Message } from 'chat';

import type {
  HistoryMessage,
  HistoryOutcome,
  TimeRange,
} from '../types/index.js';
import { toChatAccountRef } from './event-mapping.js';
import { channelAccessFailure } from './outbound.js';

/**
 * What this operation needs besides its arguments. Passed in for the same
 * reason `OutboundContext` is (`.claude/rules/coding-style.md`, "executors take
 * their work-set as input"): `platform/index.ts` (task 3.8) is what resolves a
 * `PlatformName` to the adapter serving it.
 */
export interface HistoryContext {
  readonly adapter: Adapter;
}

/** How many messages one page asks for. Every adapter caps this itself. */
const PAGE_SIZE = 100;

/**
 * How many pages one call will walk. A bound is required rather than tidy: a
 * busy channel plus a range far in the past would otherwise walk the whole
 * conversation, and design.md routes this call through a user-facing command
 * with a response deadline. Reaching the bound is reported as success with
 * whatever was found, because the alternative -- refusing -- would leave the
 * reader with nothing and no remedy to act on.
 */
const MAX_PAGES = 20;

const REMEDIES: Readonly<
  Record<'not-in-channel' | 'not-permitted' | 'unsupported', string>
> = {
  'not-in-channel':
    'bot がこのチャンネルに参加していないため、会話を読み取れません。チャンネルに bot を招待してから、もう一度お試しください。',
  'not-permitted':
    'bot に会話履歴を読み取る権限がありません。チャットサービスの管理者に、会話履歴の読み取り権限を追加したうえでアプリを入れ直してもらってください。',
  unsupported:
    'このチャットサービスでは会話履歴を読み取れません。ページにしたい内容を直接書いて保存してください。',
};

const toHistoryMessage = (
  target: ChannelRef,
  message: Message,
): HistoryMessage => ({
  postedAt: message.metadata.dateSent.toISOString(),
  // The same derivation `event-mapping.ts` uses for every other author, so a
  // person shows up under one name whether they are quoted in a page or
  // addressed the bot.
  author: toChatAccountRef(target.platform, message.author),
  text: message.text,
});

/**
 * Walks pages from the newest backwards, collecting what falls inside `range`.
 *
 * The stop condition reads the *page*, not the collected messages: a page whose
 * oldest message predates the range means everything older does too, so there
 * is nothing left to ask for even when the service still offers a cursor.
 *
 * **This assumes pages arrive newest-first.** Slack, Discord and Teams are
 * explicit about it -- each reads `direction` and pages accordingly. Mattermost
 * does not: its adapter ignores `direction` and pages by number (`0`, `1`, …),
 * so the assumption there rests on page 0 being the most recent posts. If it
 * were the other way round, this walk would stop on the first page and answer
 * an empty history for every past range -- a wrong answer rather than a
 * failure, so a Mattermost run must confirm it before this is trusted (see
 * tasks.md, Implementation Note 3.5).
 */
const collectInRange = async (
  fetchPage: (cursor: string | undefined) => Promise<FetchResult<unknown>>,
  range: TimeRange,
): Promise<ReadonlyArray<Message>> => {
  const collected: Message[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    // Sequential on purpose: each page's cursor comes from the previous page's
    // answer, so the requests cannot be issued together -- and asking for pages
    // the range does not need would be the more expensive mistake.
    // biome-ignore lint/performance/noAwaitInLoops: pagination is cursor-chained
    const result = await fetchPage(cursor);
    const messages = result.messages;
    if (messages.length === 0) return collected;

    for (const message of messages) {
      const postedAt = message.metadata.dateSent;
      if (postedAt >= range.since && postedAt <= range.until) {
        collected.push(message);
      }
    }

    const oldestOnPage = messages.reduce(
      (oldest, message) =>
        message.metadata.dateSent < oldest ? message.metadata.dateSent : oldest,
      messages[0]?.metadata.dateSent ?? range.since,
    );
    if (oldestOnPage < range.since) return collected;

    cursor = result.nextCursor;
    if (cursor == null) return collected;
  }

  return collected;
};

/**
 * The conversation posted in `target` inside `range`, oldest first.
 *
 * Ordering is applied once at the end rather than relied on: each page is
 * chronological, but the pages themselves arrive newest-first, so their
 * concatenation is not.
 *
 * An empty answer is a success, not a failure -- 「指定された範囲に発言が 1 件
 * も無い」 (Requirement 5.5) is the caller's message to write, and it needs to
 * tell that apart from being unable to read the channel at all.
 *
 * An unrecognised failure is left to propagate. Every arm of `HistoryOutcome`
 * carries a `remedy` shown to the reader, and a dropped connection has none;
 * dressing one up as something the user can fix would send them to change
 * settings that are already correct.
 */
export const fetchHistory = async (
  context: HistoryContext,
  target: ChannelRef,
  range: TimeRange,
): Promise<HistoryOutcome> => {
  const readChannel = context.adapter.fetchChannelMessages;
  if (readChannel == null) {
    // All four installed adapters implement this, so `unsupported` is not
    // reachable today; it is kept because `HistoryOutcome` declares it and
    // because an adapter is free to leave the method out (the SDK types it as
    // optional). Answering it here is how Requirement 5.6 is met without any
    // caller having to consult the capability table.
    return { ok: false, reason: 'unsupported', remedy: REMEDIES.unsupported };
  }

  try {
    const collected = await collectInRange(
      (cursor) =>
        readChannel.call(context.adapter, target.channelId, {
          limit: PAGE_SIZE,
          direction: 'backward',
          ...(cursor == null ? {} : { cursor }),
        }),
      range,
    );

    const messages = [...collected]
      .sort(
        (left, right) =>
          left.metadata.dateSent.getTime() - right.metadata.dateSent.getTime(),
      )
      .map((message) => toHistoryMessage(target, message));

    return { ok: true, messages };
  } catch (error) {
    const failure = channelAccessFailure(error);
    if (failure == null) throw error;
    return { ok: false, reason: failure, remedy: REMEDIES[failure] };
  }
};
