// design.md's ConversationReader: the messages of the thread a request was
// made in, or -- outside a thread -- the latest messages of the place, read in
// one call, oldest first, without the bot's own messages and the request
// itself (Requirement 5.7). A refusal the reader can act on, or wait out,
// becomes a reason (5.13, 5.15, 5.17); whether older messages remain becomes
// `truncated` (5.16).
//
// How each service is read, and how many messages one read may ask it for, is
// declared once in `CONVERSATION_SOURCES`; the executor below never branches
// on a service name.
import type { PlatformName } from '@growi/chat';
import {
  type Adapter,
  type FetchOptions,
  type FetchResult,
  NotImplementedError,
} from 'chat';

import type { HistoryMessage, SdkChannelRef } from '../types/index.js';
import { toChatAccountRef } from './event-mapping.js';
import type { InstallationProvider } from './installation-provider.js';
import { channelAccessFailure, threadIdOf } from './outbound.js';
import {
  isSlackRateLimited,
  readSlackConversation,
} from './slack-conversation.js';

export type ConversationReadFailureReason =
  | 'not-in-channel'
  | 'not-permitted'
  | 'unsupported'
  | 'rate-limited';

export type ConversationOutcome =
  | {
      readonly ok: true;
      readonly messages: ReadonlyArray<HistoryMessage>;
      readonly truncated: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: ConversationReadFailureReason;
      readonly remedy: string | null;
    };

export interface ConversationReadRange {
  /** The thread to read; `null` reads the place's latest messages. */
  readonly threadRootId: string | null;
  /** The request's own message, left out of the answer. */
  readonly requestMessageId: string | null;
  readonly limit: number;
}

/** What a read needs besides its arguments. */
export interface ConversationReadContext {
  readonly adapter: Adapter;
  readonly installationId: string;
  readonly installations: InstallationProvider;
  /** Slack's Web API root; the service's own when absent. */
  readonly slackApiUrl?: string;
}

/** One message as read, before the bot's own and the request are left out. */
export interface ReadMessage {
  readonly id: string;
  readonly postedAt: Date;
  readonly author: HistoryMessage['author'];
  readonly text: string;
  readonly fromBot: boolean;
}

export interface ConversationPage {
  readonly messages: ReadonlyArray<ReadMessage>;
  /**
   * Older messages remain than this read returns: the service said so, or the
   * read left some out to return only the newest.
   */
  readonly hasMore: boolean;
}

export interface ConversationReadSize {
  /** The most the read returns, the newest ones. */
  readonly keep: number;
  /** The most one call asks for a thread; see `ConversationSource`. */
  readonly perThreadCall: number;
}

export type ConversationPageReader = (
  context: ConversationReadContext,
  target: SdkChannelRef,
  threadRootId: string | null,
  size: ConversationReadSize,
) => Promise<ConversationPage>;

export interface ConversationSource {
  /** The most one read returns. */
  readonly maxPerRead: number;
  /**
   * The most one call asks for when the service answers a thread oldest
   * first, so that the newest `maxPerRead` are cut from a larger answer.
   * `maxPerRead` when absent.
   */
  readonly maxPerThreadCall?: number;
  /** When `false`, a read outside a thread answers `unsupported`, unasked. */
  readonly readsLatestOfPlace: boolean;
  readonly read: ConversationPageReader;
}

/**
 * The adapter's own read of the thread, or of the channel.
 *
 * Each service read this way speaks with one bot per adapter (none of them
 * declares `bindInstallation`), so nothing is run inside an installation's
 * scope here; Slack, the one that does, is read by `readSlackConversation`.
 */
const fetchPageOf = (
  adapter: Adapter,
  target: SdkChannelRef,
  threadRootId: string | null,
  options: FetchOptions,
): Promise<FetchResult> => {
  if (threadRootId != null) {
    return adapter.fetchMessages(
      threadIdOf(adapter, target.platform, target.channelId, threadRootId),
      options,
    );
  }
  if (adapter.fetchChannelMessages == null) {
    throw new NotImplementedError(
      `the ${target.platform} adapter cannot read a channel`,
      'fetchChannelMessages',
    );
  }
  return adapter.fetchChannelMessages(target.channelId, options);
};

/**
 * Through the adapter's own reads. Each adapter read this way names a cursor
 * when it judges that more messages remain; Discord's judgement is "the page
 * came back full".
 */
const readThroughAdapter: ConversationPageReader = async (
  { adapter },
  target,
  threadRootId,
  { keep },
) => {
  const page = await fetchPageOf(adapter, target, threadRootId, {
    limit: keep,
    direction: 'backward',
  });
  return {
    messages: page.messages.map((message) => ({
      id: message.id,
      postedAt: message.metadata.dateSent,
      author: toChatAccountRef(target.platform, message.author),
      text: message.text,
      fromBot: message.author.isMe,
    })),
    hasMore: page.nextCursor != null,
  };
};

/**
 * Per service: how it is read, the most one read returns, and whether the
 * place's latest messages can be read at all. Slack is read with its own Web
 * API client rather than through the adapter, so that a rate limit comes back
 * at once instead of being retried (design.md, ConversationReader); it answers
 * a thread oldest first, up to 1000 per call. Teams' 50 is not yet confirmed
 * on a real tenant.
 */
export const CONVERSATION_SOURCES: Readonly<
  Record<PlatformName, ConversationSource>
> = {
  slack: {
    maxPerRead: 200,
    maxPerThreadCall: 1000,
    readsLatestOfPlace: true,
    read: readSlackConversation,
  },
  discord: {
    maxPerRead: 100,
    readsLatestOfPlace: true,
    read: readThroughAdapter,
  },
  teams: { maxPerRead: 50, readsLatestOfPlace: true, read: readThroughAdapter },
  // chat-adapter-mattermost 1.1.3 sends the channel read's query inside the
  // path, so the read never reaches the posts endpoint. Recheck on every
  // version of the adapter: the pin in `conversation-history.integ.ts` fails
  // once it is fixed.
  mattermost: {
    maxPerRead: 200,
    readsLatestOfPlace: false,
    read: readThroughAdapter,
  },
};

const REMEDIES: Readonly<Record<ConversationReadFailureReason, string | null>> =
  {
    'not-in-channel':
      'bot がこの場所に参加していないため、会話を読めません。bot を招待してから、もう一度お試しください。',
    'not-permitted':
      'bot に会話の履歴を読む権限がありません。チャットサービスの管理者に、履歴を読む権限を足してアプリを入れ直してもらってください。',
    unsupported: null,
    'rate-limited': null,
  };

interface ReadFailureRow {
  readonly failure: ConversationReadFailureReason;
  readonly matches: (error: Error & Record<string, unknown>) => boolean;
}

/**
 * What only a read is refused with, checked before the rows every channel
 * operation shares (`channelAccessFailure`). Recognised structurally, as in
 * `outbound.ts`, from the shapes the installed adapters and clients throw.
 */
const READ_FAILURE_ROWS: ReadonlyArray<ReadFailureRow> = [
  { failure: 'rate-limited', matches: isSlackRateLimited },
  // `RateLimitError` (chat) and `AdapterRateLimitError` (@chat-adapter/shared).
  {
    failure: 'rate-limited',
    matches: (error) => error.code === 'RATE_LIMITED',
  },
  {
    failure: 'rate-limited',
    matches: (error) =>
      error.name === 'NetworkError' &&
      /Discord API error: 429\b/.test(error.message),
  },
  // Teams reads through Graph, whose errors reach here untranslated.
  {
    failure: 'rate-limited',
    matches: (error) => error.name === 'GraphError' && error.statusCode === 429,
  },
  {
    failure: 'not-permitted',
    matches: (error) => error.name === 'GraphError' && error.statusCode === 403,
  },
  {
    failure: 'not-in-channel',
    matches: (error) => error.name === 'GraphError' && error.statusCode === 404,
  },
  // The Teams adapter turns a chat's 403 into this, naming the permissions.
  {
    failure: 'not-permitted',
    matches: (error) =>
      error.name === 'NotImplementedError' && /permission/i.test(error.message),
  },
  {
    failure: 'unsupported',
    matches: (error) => error.name === 'NotImplementedError',
  },
];

const readFailureOf = (
  error: unknown,
): ConversationReadFailureReason | null => {
  if (!(error instanceof Error)) return null;
  const carrier = error as Error & Record<string, unknown>;
  return (
    READ_FAILURE_ROWS.find((row) => row.matches(carrier))?.failure ??
    channelAccessFailure(error)
  );
};

const withoutRequestOf = (error: unknown): Error => {
  if (!(error instanceof Error)) return new Error(String(error));
  return Object.assign(new Error(error.message), { name: error.name });
};

/**
 * Reads once. `truncated` is what the read said of the conversation, so
 * leaving out the bot's messages and the request does not change it.
 *
 * A failure no row names propagates: every reason carries a meaning for the
 * reader, and a dropped connection or a timeout has none of them. It is
 * rethrown as a new error holding only the original's `name` and `message`:
 * the original (Teams' Graph client throws its HTTP client's error as is)
 * carries the request it came from, `Authorization: Bearer <token>` included,
 * to whoever logs it.
 */
export const fetchConversation = async (
  context: ConversationReadContext,
  sources: Readonly<Record<PlatformName, ConversationSource>>,
  target: SdkChannelRef,
  range: ConversationReadRange,
): Promise<ConversationOutcome> => {
  const source = sources[target.platform];
  if (range.threadRootId == null && !source.readsLatestOfPlace) {
    return { ok: false, reason: 'unsupported', remedy: REMEDIES.unsupported };
  }
  const keep = Math.min(range.limit, source.maxPerRead);
  let page: ConversationPage;
  try {
    page = await source.read(context, target, range.threadRootId, {
      keep,
      perThreadCall: source.maxPerThreadCall ?? keep,
    });
  } catch (error) {
    const reason = readFailureOf(error);
    if (reason == null) throw withoutRequestOf(error);
    return { ok: false, reason, remedy: REMEDIES[reason] };
  }

  const messages = page.messages
    .filter(
      (message) => !message.fromBot && message.id !== range.requestMessageId,
    )
    .toSorted(
      (left, right) => left.postedAt.getTime() - right.postedAt.getTime(),
    )
    .map(({ postedAt, author, text }) => ({
      postedAt: postedAt.toISOString(),
      author,
      text,
    }));
  return { ok: true, messages, truncated: page.hasMore };
};
