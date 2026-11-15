// Slack's conversation read, made with a Web API client of its own rather than
// through the adapter: the adapter's client waits out and retries a rate limit
// for about thirty minutes, and the read has to report one at once instead
// (design.md, ConversationReader). Going around the adapter also means its
// author lookup is not available, so the authors' names are looked up here.
import { ErrorCode, WebClient, type WebClientOptions } from '@slack/web-api';
import type { Adapter } from 'chat';

import { nativeChannelIdOf } from '../capabilities/index.js';
import type { SdkChannelRef } from '../types/index.js';
import type {
  ConversationPageReader,
  ReadMessage,
} from './conversation-history.js';
import { toChatAccountRef } from './event-mapping.js';
import { installationCredentialsOf } from './installation-scope.js';

/**
 * Every call this read makes -- the read, `auth.test`, `users.info` -- gives
 * up at once on a rate limit or any other failure, and after five seconds on
 * a server that does not answer. The client's default retry policy would try
 * again for about thirty minutes on each of those.
 */
const READ_CLIENT_OPTIONS = {
  rejectRateLimitedCalls: true,
  timeout: 5_000,
  retryConfig: { retries: 0 },
} satisfies WebClientOptions;

/** How many `users.info` calls are in flight at once. */
const NAME_LOOKUP_CONCURRENCY = 4;

interface SlackMessage {
  readonly ts?: string;
  readonly user?: string;
  readonly username?: string;
}

/**
 * Slack refused for rate: HTTP 429 (with `rejectRateLimitedCalls`), or
 * `ratelimited` inside an HTTP 200.
 */
export const isSlackRateLimited = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const { code, data } = error as Error & {
    readonly code?: unknown;
    readonly data?: { readonly error?: unknown };
  };
  return (
    code === ErrorCode.RateLimitedError ||
    (code === ErrorCode.PlatformError && data?.error === 'ratelimited')
  );
};

// Keyed by token, kept only on success: the same caching as `botUserIdOf` in
// `slack-installation-lookup.ts`, asked through this read's own client.
const botUserIds = new Map<string, Promise<string>>();

const botUserIdOf = (client: WebClient, token: string): Promise<string> => {
  const known = botUserIds.get(token);
  if (known != null) return known;

  const asked = (async () => {
    const answer = await client.auth.test();
    if (answer.user_id == null || answer.user_id === '') {
      throw new Error('Slack auth.test answered no user_id');
    }
    return answer.user_id;
  })();
  botUserIds.set(token, asked);
  asked.catch(() => botUserIds.delete(token));
  return asked;
};

/**
 * The name each of `userIds` is shown by, for those Slack would tell. A user
 * left out is shown by their id. The first rate limit stops the lookups that
 * have not started yet: a name is not worth failing the read for.
 */
const displayNamesOf = async (
  client: WebClient,
  userIds: ReadonlySet<string>,
): Promise<ReadonlyMap<string, string>> => {
  const names = new Map<string, string>();
  const waiting = [...userIds];
  let rateLimited = false;

  const lookUpWaiting = async (): Promise<void> => {
    for (
      let userId = waiting.shift();
      userId != null && !rateLimited;
      userId = waiting.shift()
    ) {
      try {
        // biome-ignore lint/performance/noAwaitInLoops: bounded concurrency
        const { user } = await client.users.info({ user: userId });
        const name =
          user?.real_name ||
          user?.profile?.real_name ||
          user?.profile?.display_name ||
          user?.name;
        if (name != null && name !== '') names.set(userId, name);
      } catch (error) {
        if (isSlackRateLimited(error)) rateLimited = true;
      }
    }
  };

  await Promise.all(
    Array.from({ length: NAME_LOOKUP_CONCURRENCY }, lookUpWaiting),
  );
  return names;
};

const toReadMessage = (
  raw: SlackMessage,
  {
    adapter,
    target,
    botUserId,
    names,
  }: {
    readonly adapter: Adapter;
    readonly target: SdkChannelRef;
    readonly botUserId: string;
    readonly names: ReadonlyMap<string, string>;
  },
): ReadMessage => {
  // The adapter's own synchronous parse, for the plain text every other
  // service's messages are read as. It looks nothing up, so its author name
  // is the user id; the name looked up above replaces it.
  const parsed = adapter.parseMessage({
    ...raw,
    channel: nativeChannelIdOf(target),
  });
  const author = toChatAccountRef(target.platform, parsed.author);
  const name = raw.user == null ? undefined : names.get(raw.user);
  return {
    id: raw.ts ?? '',
    postedAt: parsed.metadata.dateSent,
    author: name == null ? author : { ...author, displayName: name },
    text: parsed.text,
    fromBot: raw.user === botUserId,
  };
};

export const readSlackConversation: ConversationPageReader = async (
  context,
  target,
  threadRootId,
  limit,
) => {
  const { credentials } = await installationCredentialsOf(
    'slack',
    context.installationId,
    context.installations,
  );
  const token = credentials.slack?.botToken;
  if (token == null) {
    throw new Error(
      `installation ${context.installationId} has no Slack bot token on record`,
    );
  }
  const client = new WebClient(token, {
    ...READ_CLIENT_OPTIONS,
    ...(context.slackApiUrl == null
      ? {}
      : { slackApiUrl: context.slackApiUrl }),
  });
  const channel = nativeChannelIdOf(target);
  const botUserId = await botUserIdOf(client, token);

  const answer =
    threadRootId == null
      ? await client.conversations.history({ channel, limit })
      : await client.conversations.replies({
          channel,
          ts: threadRootId,
          limit,
        });
  const raws: ReadonlyArray<SlackMessage> = answer.messages ?? [];

  const names = await displayNamesOf(
    client,
    new Set(
      raws.flatMap((raw) =>
        raw.user == null || raw.username != null || raw.user === botUserId
          ? []
          : [raw.user],
      ),
    ),
  );
  return {
    messages: raws.map((raw) =>
      toReadMessage(raw, {
        adapter: context.adapter,
        target,
        botUserId,
        names,
      }),
    ),
    hasMore: answer.has_more === true,
  };
};
