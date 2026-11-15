// Reading a conversation through the REAL Slack Web API client and the REAL
// Discord adapter, with only the services' HTTP replaced by local stand-ins:
// which call reads a thread and which reads the place's latest messages, what
// comes back, and what a refusal -- a missing bot, a rate limit -- becomes.
// Also what the REAL Mattermost adapter sends for a channel read, which is why
// that read is declared unsupported. None of them needs the Chat SDK state
// here, so no database is touched.
import { randomInt } from 'node:crypto';
import { createDiscordAdapter } from '@chat-adapter/discord';
import { SlackAdapter } from '@chat-adapter/slack';
import { createMattermostAdapter } from 'chat-adapter-mattermost';
import { mock } from 'vitest-mock-extended';

import { toSdkChannelId } from '../capabilities/index.js';
import type { InstallationCredentials, SdkChannelRef } from '../types/index.js';
import {
  type ChatServiceStandIn,
  type ReceivedRequest,
  type StandInReply,
  startChatServiceStandIn,
} from './chat-service-stand-in.js';
import {
  CONVERSATION_SOURCES,
  type ConversationReadContext,
  fetchConversation,
} from './conversation-history.js';
import type { InstallationProvider } from './installation-provider.js';

const unique = (): string => `${Date.now()}${randomInt(100_000, 999_999)}`;

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const serviceOf = async (
  responder: (request: ReceivedRequest) => StandInReply | Promise<StandInReply>,
): Promise<ChatServiceStandIn> => {
  const service = await startChatServiceStandIn(responder);
  closers.push(service.close);
  return service;
};

const elapsedMs = async <T>(
  work: () => Promise<T>,
): Promise<{
  readonly settled: PromiseSettledResult<T>;
  readonly ms: number;
}> => {
  const started = Date.now();
  const [settled] = await Promise.allSettled([work()]);
  if (settled == null) throw new Error('nothing settled');
  return { settled, ms: Date.now() - started };
};

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

const SLACK_CHANNEL = 'C0000000X';
const SLACK_BOT_USER = 'U0BOT0001';
const SLACK_ROOT = '1700000000.000100';
const SLACK_REQUEST = '1700000400.000500';
const ALICE = 'U0ALICE01';
const BOB = 'U0BOB0001';
const NAMES: Readonly<Record<string, string>> = {
  [ALICE]: 'Alice Liddell',
  [BOB]: 'Bob Builder',
};

const slackChannel: SdkChannelRef = {
  platform: 'slack',
  channelId: toSdkChannelId('slack', `slack:${SLACK_CHANNEL}`),
  channelName: 'general',
  isPrivate: false,
};

const slackMessage = (ts: string, user: string, text: string) => ({
  type: 'message',
  ts,
  user,
  text,
  ...(user === SLACK_BOT_USER ? { bot_id: 'B0BOT0001' } : {}),
});

/** A thread: the root, two people's replies, the bot's reply, the request. */
const THREAD = [
  slackMessage(SLACK_ROOT, ALICE, 'shall we ship on Friday?'),
  slackMessage('1700000100.000200', BOB, 'only if *QA* signs off'),
  slackMessage('1700000200.000300', SLACK_BOT_USER, 'a reply from the bot'),
  slackMessage('1700000300.000400', ALICE, 'QA signed off'),
  slackMessage(SLACK_REQUEST, ALICE, '<@U0BOT0001> agent summarize this'),
];

type SlackMethodAnswer = (
  request: ReceivedRequest,
) => StandInReply | Promise<StandInReply>;

const slackMethodOf = (request: ReceivedRequest): string =>
  request.path.replace(/^\/api\//, '').replace(/\?.*$/, '');

const startSlack = async (
  answers: Readonly<Record<string, SlackMethodAnswer>> = {},
) => {
  const defaults: Readonly<Record<string, SlackMethodAnswer>> = {
    'auth.test': () => ({
      body: { ok: true, user_id: SLACK_BOT_USER, team_id: 'T0000000X' },
    }),
    'users.info': ({ body }) => {
      const user = (body as { user?: string } | null)?.user ?? '';
      const name = NAMES[user];
      return {
        body:
          name == null
            ? { ok: false, error: 'user_not_found' }
            : { ok: true, user: { id: user, name: user, real_name: name } },
      };
    },
    'conversations.replies': () => ({
      body: { ok: true, messages: THREAD, has_more: false },
    }),
    'conversations.history': () => ({
      body: {
        ok: true,
        messages: [...THREAD].reverse(),
        has_more: false,
      },
    }),
  };
  const service = await serviceOf((request) => {
    const method = slackMethodOf(request);
    const answer = answers[method] ?? defaults[method];
    return answer?.(request) ?? { body: { ok: false, error: 'unknown' } };
  });
  return service;
};

const credentialsOf = (
  botToken: string | undefined,
): InstallationCredentials | null =>
  botToken == null ? null : { slack: { botToken } };

const slackInstallations = (tokens: Readonly<Record<string, string>>) =>
  mock<InstallationProvider>({
    list: async (platform) =>
      platform === 'slack'
        ? Object.keys(tokens).map((workspaceId) => ({
            installationId: `installation-${workspaceId}`,
            workspaceId,
          }))
        : [],
    resolve: async (platform, workspaceId) =>
      platform === 'slack' ? credentialsOf(tokens[workspaceId]) : null,
  });

const slackContext = (
  service: ChatServiceStandIn,
  overrides: Partial<ConversationReadContext> = {},
): ConversationReadContext => ({
  // Only for turning Slack's own message format into plain text; it is never
  // asked to reach the service.
  adapter: new SlackAdapter({
    botToken: 'xoxb-unused',
    signingSecret: 'signing-secret',
  }),
  installationId: 'installation-T1',
  // A token of its own per test, so the bot user id cached per token is asked
  // of this test's stand-in.
  installations: slackInstallations({ T1: `xoxb-${unique()}` }),
  slackApiUrl: `${service.url}/api/`,
  ...overrides,
});

const requestsTo = (service: ChatServiceStandIn, method: string) =>
  service.requests.filter((request) => slackMethodOf(request) === method);

const IN_THREAD = {
  threadRootId: SLACK_ROOT,
  requestMessageId: SLACK_REQUEST,
  limit: 200,
};
const RECENT = {
  threadRootId: null,
  requestMessageId: SLACK_REQUEST,
  limit: 200,
};

describe('Slack', () => {
  it("reads the request's thread, oldest first, without the bot's replies or the request", async () => {
    const slack = await startSlack();

    const outcome = await fetchConversation(
      slackContext(slack),
      CONVERSATION_SOURCES,
      slackChannel,
      IN_THREAD,
    );

    expect(outcome).toEqual({
      ok: true,
      truncated: false,
      messages: [
        {
          postedAt: new Date(1_700_000_000_000).toISOString(),
          author: {
            platform: 'slack',
            accountId: ALICE,
            displayName: 'Alice Liddell',
          },
          text: 'shall we ship on Friday?',
        },
        {
          postedAt: new Date(1_700_000_100_000).toISOString(),
          author: {
            platform: 'slack',
            accountId: BOB,
            displayName: 'Bob Builder',
          },
          text: 'only if QA signs off',
        },
        {
          postedAt: new Date(1_700_000_300_000).toISOString(),
          author: {
            platform: 'slack',
            accountId: ALICE,
            displayName: 'Alice Liddell',
          },
          text: 'QA signed off',
        },
      ],
    });
    expect(requestsTo(slack, 'conversations.replies')).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({
          channel: SLACK_CHANNEL,
          ts: SLACK_ROOT,
          limit: '1000',
        }),
      }),
    ]);
    expect(requestsTo(slack, 'conversations.history')).toEqual([]);
  });

  describe('a long thread', () => {
    const ROOTER = 'U0ROOTER1';

    /** The root and `replies` replies, oldest first, as Slack answers. */
    const longThread = (replies: number) => [
      slackMessage(SLACK_ROOT, ROOTER, 'the root'),
      ...Array.from({ length: replies }, (_, i) =>
        slackMessage(
          `${1_700_000_000 + i + 1}.000100`,
          i % 2 === 0 ? ALICE : BOB,
          `reply ${i + 1}`,
        ),
      ),
    ];

    const slackAnswering = (
      messages: ReturnType<typeof longThread>,
      hasMore = false,
    ) =>
      startSlack({
        'conversations.replies': () => ({
          body: { ok: true, messages, has_more: hasMore },
        }),
      });

    const replyTexts = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => `reply ${from + i}`);

    it('returns the newest 200, oldest first, and says older ones remain', async () => {
      const slack = await slackAnswering(longThread(250));

      const outcome = await fetchConversation(
        slackContext(slack),
        CONVERSATION_SOURCES,
        slackChannel,
        IN_THREAD,
      );

      expect(outcome).toMatchObject({ ok: true, truncated: true });
      expect(outcome.ok && outcome.messages.map((m) => m.text)).toEqual(
        replyTexts(51, 250),
      );
    });

    it('returns every message, and says none remain, when the thread fits in 200', async () => {
      const slack = await slackAnswering(longThread(199));

      const outcome = await fetchConversation(
        slackContext(slack),
        CONVERSATION_SOURCES,
        slackChannel,
        IN_THREAD,
      );

      expect(outcome).toMatchObject({ ok: true, truncated: false });
      expect(outcome.ok && outcome.messages.map((m) => m.text)).toEqual([
        'the root',
        ...replyTexts(1, 199),
      ]);
    });

    it('returns only as many of the newest as the caller asks for', async () => {
      const slack = await slackAnswering(longThread(50));

      const outcome = await fetchConversation(
        slackContext(slack),
        CONVERSATION_SOURCES,
        slackChannel,
        { ...IN_THREAD, limit: 30 },
      );

      expect(outcome).toMatchObject({ ok: true, truncated: true });
      expect(outcome.ok && outcome.messages.map((m) => m.text)).toEqual(
        replyTexts(21, 50),
      );
      expect(requestsTo(slack, 'conversations.replies')).toEqual([
        expect.objectContaining({
          body: expect.objectContaining({ limit: '1000' }),
        }),
      ]);
    });

    it('does not look up the authors of the messages it leaves out', async () => {
      const slack = await slackAnswering(longThread(250));

      await fetchConversation(
        slackContext(slack),
        CONVERSATION_SOURCES,
        slackChannel,
        IN_THREAD,
      );

      expect(
        requestsTo(slack, 'users.info').map(
          (request) => (request.body as { user?: string }).user,
        ),
      ).not.toContain(ROOTER);
    });

    it('says older messages remain when Slack answers fewer than it was asked for and offers more', async () => {
      const slack = await slackAnswering(longThread(14), true);

      const outcome = await fetchConversation(
        slackContext(slack),
        CONVERSATION_SOURCES,
        slackChannel,
        IN_THREAD,
      );

      expect(outcome).toMatchObject({ ok: true, truncated: true });
      expect(outcome.ok && outcome.messages.map((m) => m.text)).toEqual([
        'the root',
        ...replyTexts(1, 14),
      ]);
    });

    // Slack answers a thread from its oldest message, 1000 at most per call;
    // past that, one call cannot reach the latest replies.
    it('says older messages remain, returning the newest 200 of what one call reached, when the thread is longer than one call', async () => {
      const reached = longThread(999);
      const slack = await slackAnswering(reached, true);

      const outcome = await fetchConversation(
        slackContext(slack),
        CONVERSATION_SOURCES,
        slackChannel,
        IN_THREAD,
      );

      expect(outcome).toMatchObject({ ok: true, truncated: true });
      expect(outcome.ok && outcome.messages.map((m) => m.text)).toEqual(
        replyTexts(800, 999),
      );
      expect(requestsTo(slack, 'conversations.replies')).toHaveLength(1);
    });
  });

  it('reads the latest messages of the place when the request is not in a thread, oldest first', async () => {
    const slack = await startSlack();

    const outcome = await fetchConversation(
      slackContext(slack),
      CONVERSATION_SOURCES,
      slackChannel,
      RECENT,
    );

    expect(outcome.ok && outcome.messages.map((m) => m.text)).toEqual([
      'shall we ship on Friday?',
      'only if QA signs off',
      'QA signed off',
    ]);
    expect(requestsTo(slack, 'conversations.history')).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({ channel: SLACK_CHANNEL, limit: '200' }),
      }),
    ]);
    expect(
      requestsTo(slack, 'conversations.history')[0]?.body,
    ).not.toHaveProperty('ts');
    expect(requestsTo(slack, 'conversations.replies')).toEqual([]);
  });

  it('says the range was limited when Slack has more messages than one read returns', async () => {
    const slack = await startSlack({
      'conversations.history': () => ({
        body: { ok: true, messages: [...THREAD].reverse(), has_more: true },
      }),
    });

    const outcome = await fetchConversation(
      slackContext(slack),
      CONVERSATION_SOURCES,
      slackChannel,
      RECENT,
    );

    expect(outcome).toMatchObject({ ok: true, truncated: true });
  });

  it('looks each author up once, and never the bot', async () => {
    const slack = await startSlack();

    await fetchConversation(
      slackContext(slack),
      CONVERSATION_SOURCES,
      slackChannel,
      IN_THREAD,
    );

    expect(
      requestsTo(slack, 'users.info')
        .map((request) => (request.body as { user?: string }).user)
        .sort(),
    ).toEqual([ALICE, BOB].sort());
  });

  it('shows an author whose name cannot be looked up by their id', async () => {
    const carol = 'U0CAROL01';
    const slack = await startSlack({
      'conversations.history': () => ({
        body: {
          ok: true,
          messages: [
            slackMessage('1700000100.000200', carol, 'from someone unknown'),
            slackMessage(SLACK_ROOT, ALICE, 'from Alice'),
          ],
          has_more: false,
        },
      }),
    });

    const outcome = await fetchConversation(
      slackContext(slack),
      CONVERSATION_SOURCES,
      slackChannel,
      RECENT,
    );

    expect(
      outcome.ok && outcome.messages.map((m) => m.author.displayName),
    ).toEqual(['Alice Liddell', carol]);
  });

  it('still reads the conversation, with ids for names, when the name lookups are rate limited', async () => {
    const slack = await startSlack({
      'users.info': () => ({ status: 429, headers: { 'retry-after': '30' } }),
    });

    const { settled, ms } = await elapsedMs(() =>
      fetchConversation(
        slackContext(slack),
        CONVERSATION_SOURCES,
        slackChannel,
        IN_THREAD,
      ),
    );

    expect(ms).toBeLessThan(5_000);
    expect(settled).toEqual({
      status: 'fulfilled',
      value: expect.objectContaining({ ok: true }),
    });
    const value = settled.status === 'fulfilled' ? settled.value : null;
    expect(
      value?.ok && value.messages.map((m) => m.author.displayName),
    ).toEqual([ALICE, BOB, ALICE]);
  });

  it('stops looking names up once Slack says the lookups are rate limited', async () => {
    const authors = Array.from({ length: 12 }, (_, i) => `U0PERSON${i}`);
    const slack = await startSlack({
      'conversations.history': () => ({
        body: {
          ok: true,
          messages: authors.map((user, i) =>
            slackMessage(
              `17000000${String(i).padStart(2, '0')}.000100`,
              user,
              'hi',
            ),
          ),
          has_more: false,
        },
      }),
      'users.info': () => ({ status: 429, headers: { 'retry-after': '30' } }),
    });

    await fetchConversation(
      slackContext(slack),
      CONVERSATION_SOURCES,
      slackChannel,
      RECENT,
    );

    expect(requestsTo(slack, 'users.info').length).toBeLessThan(authors.length);
  });

  it('answers rate-limited at once, without waiting or asking again, when Slack answers 429', async () => {
    const slack = await startSlack({
      'conversations.history': () => ({
        status: 429,
        headers: { 'retry-after': '30' },
      }),
    });

    const { settled, ms } = await elapsedMs(() =>
      fetchConversation(
        slackContext(slack),
        CONVERSATION_SOURCES,
        slackChannel,
        RECENT,
      ),
    );

    expect(settled).toEqual({
      status: 'fulfilled',
      value: { ok: false, reason: 'rate-limited', remedy: null },
    });
    expect(ms).toBeLessThan(5_000);
    expect(requestsTo(slack, 'conversations.history')).toHaveLength(1);
  });

  it('answers rate-limited when Slack says so inside an ordinary answer', async () => {
    const slack = await startSlack({
      'conversations.replies': () => ({
        body: { ok: false, error: 'ratelimited' },
      }),
    });

    const outcome = await fetchConversation(
      slackContext(slack),
      CONVERSATION_SOURCES,
      slackChannel,
      IN_THREAD,
    );

    expect(outcome).toEqual({
      ok: false,
      reason: 'rate-limited',
      remedy: null,
    });
  });

  it.each([
    ['not_in_channel', 'not-in-channel'],
    ['channel_not_found', 'not-in-channel'],
    ['missing_scope', 'not-permitted'],
  ] as const)('answers %s as %s, with what to do about it', async (error, reason) => {
    const slack = await startSlack({
      'conversations.history': () => ({ body: { ok: false, error } }),
    });

    const outcome = await fetchConversation(
      slackContext(slack),
      CONVERSATION_SOURCES,
      slackChannel,
      RECENT,
    );

    expect(outcome).toEqual({ ok: false, reason, remedy: expect.any(String) });
  });

  it('does not ask again after a failure it cannot name, and lets it propagate', async () => {
    const slack = await startSlack({
      'conversations.history': () => ({ status: 500, body: {} }),
    });

    await expect(
      fetchConversation(
        slackContext(slack),
        CONVERSATION_SOURCES,
        slackChannel,
        RECENT,
      ),
    ).rejects.toThrow();
    expect(requestsTo(slack, 'conversations.history')).toHaveLength(1);
  });

  it('stops waiting for Slack after five seconds', async () => {
    const slack = await startSlack({
      'conversations.history': () =>
        new Promise<StandInReply>((resolve) =>
          setTimeout(
            () =>
              resolve({ body: { ok: true, messages: [], has_more: false } }),
            9_000,
          ),
        ),
    });

    const { settled, ms } = await elapsedMs(() =>
      fetchConversation(
        slackContext(slack),
        CONVERSATION_SOURCES,
        slackChannel,
        RECENT,
      ),
    );

    expect(settled.status).toBe('rejected');
    expect(ms).toBeGreaterThanOrEqual(4_500);
    expect(ms).toBeLessThan(7_000);
  }, 15_000);

  it("reads with the named installation's token, and no other", async () => {
    const slack = await startSlack();
    const installations = slackInstallations({
      T1: `xoxb-one-${unique()}`,
      T2: `xoxb-two-${unique()}`,
    });
    const tokenOfT2 = (await installations.resolve('slack', 'T2'))?.slack
      ?.botToken;

    const outcome = await fetchConversation(
      slackContext(slack, { installations, installationId: 'installation-T2' }),
      CONVERSATION_SOURCES,
      slackChannel,
      RECENT,
    );

    expect(outcome).toMatchObject({ ok: true });
    expect(slack.requests.length).toBeGreaterThan(0);
    expect(
      new Set(slack.requests.map((request) => request.authorization)),
    ).toEqual(new Set([`Bearer ${tokenOfT2}`]));
  });

  it('refuses to read for an installation this proxy does not hold, sending nothing', async () => {
    const slack = await startSlack();

    await expect(
      fetchConversation(
        slackContext(slack, { installationId: 'installation-elsewhere' }),
        CONVERSATION_SOURCES,
        slackChannel,
        RECENT,
      ),
    ).rejects.toThrow();
    expect(slack.requests).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Discord
// ---------------------------------------------------------------------------

const DISCORD_APPLICATION = '900000000000000001';
const DISCORD_CHANNEL = '930000000000000001';
const DISCORD_THREAD = '950000000000000001';
const DISCORD_REQUEST = '960000000000000009';

const discordChannel: SdkChannelRef = {
  platform: 'discord',
  channelId: toSdkChannelId(
    'discord',
    `discord:700000000000000001:${DISCORD_CHANNEL}`,
  ),
  channelName: 'general',
  isPrivate: false,
};

const discordMessage = (id: string, authorId: string, minute: number) => ({
  id,
  type: 0,
  channel_id: DISCORD_THREAD,
  author: {
    id: authorId,
    username: `user${authorId.slice(-2)}`,
    global_name: `Person ${authorId.slice(-2)}`,
    ...(authorId === DISCORD_APPLICATION ? { bot: true } : {}),
  },
  content: `message ${id}`,
  timestamp: new Date(Date.UTC(2026, 8, 1, 9, minute)).toISOString(),
  edited_timestamp: null,
  attachments: [],
});

/** Newest first, the order Discord answers in. */
const DISCORD_PAGE = [
  discordMessage(DISCORD_REQUEST, '920000000000000001', 4),
  discordMessage('960000000000000003', DISCORD_APPLICATION, 3),
  discordMessage('960000000000000002', '920000000000000002', 2),
  discordMessage('960000000000000001', '920000000000000001', 1),
];

const startDiscord = async (
  answer: (request: ReceivedRequest) => StandInReply = () => ({
    body: DISCORD_PAGE,
  }),
) => {
  const service = await serviceOf(answer);
  const adapter = createDiscordAdapter({
    applicationId: DISCORD_APPLICATION,
    publicKey: 'a'.repeat(64),
    botToken: 'discord-bot-token',
    apiUrl: `${service.url}/api/v10`,
  });
  const context: ConversationReadContext = {
    adapter,
    installationId: 'installation-discord',
    installations: mock<InstallationProvider>(),
  };
  return { service, context };
};

const discordPaths = (service: ChatServiceStandIn) =>
  service.requests.map((request) => `${request.method} ${request.path}`);

describe('Discord', () => {
  it("reads the request's thread channel, oldest first, without the bot or the request", async () => {
    const discord = await startDiscord();

    const outcome = await fetchConversation(
      discord.context,
      CONVERSATION_SOURCES,
      discordChannel,
      {
        threadRootId: DISCORD_THREAD,
        requestMessageId: DISCORD_REQUEST,
        limit: 200,
      },
    );

    expect(outcome).toEqual({
      ok: true,
      truncated: false,
      messages: [
        {
          postedAt: '2026-09-01T09:01:00.000Z',
          author: {
            platform: 'discord',
            accountId: '920000000000000001',
            displayName: 'Person 01',
          },
          text: 'message 960000000000000001',
        },
        {
          postedAt: '2026-09-01T09:02:00.000Z',
          author: {
            platform: 'discord',
            accountId: '920000000000000002',
            displayName: 'Person 02',
          },
          text: 'message 960000000000000002',
        },
      ],
    });
    expect(discordPaths(discord.service)).toEqual([
      `GET /api/v10/channels/${DISCORD_THREAD}/messages?limit=100`,
    ]);
  });

  it('reads the latest messages of the channel when the request is not in a thread', async () => {
    const discord = await startDiscord();

    const outcome = await fetchConversation(
      discord.context,
      CONVERSATION_SOURCES,
      discordChannel,
      { threadRootId: null, requestMessageId: DISCORD_REQUEST, limit: 200 },
    );

    expect(outcome.ok && outcome.messages).toHaveLength(2);
    expect(discordPaths(discord.service)).toEqual([
      `GET /api/v10/channels/${DISCORD_CHANNEL}/messages?limit=100`,
    ]);
  });

  it('says the range was limited when a full read comes back', async () => {
    const full = Array.from({ length: 100 }, (_, i) =>
      discordMessage(
        `9700000000000${String(1000 - i).padStart(5, '0')}`,
        '920000000000000001',
        0,
      ),
    );
    const discord = await startDiscord(() => ({ body: full }));

    const outcome = await fetchConversation(
      discord.context,
      CONVERSATION_SOURCES,
      discordChannel,
      { threadRootId: null, requestMessageId: null, limit: 200 },
    );

    expect(outcome).toMatchObject({ ok: true, truncated: true });
    expect(outcome.ok && outcome.messages).toHaveLength(100);
  });

  it('answers not-in-channel when Discord refuses the bot access', async () => {
    const discord = await startDiscord(() => ({
      status: 403,
      body: { message: 'Missing Access', code: 50001 },
    }));

    const outcome = await fetchConversation(
      discord.context,
      CONVERSATION_SOURCES,
      discordChannel,
      { threadRootId: null, requestMessageId: null, limit: 200 },
    );

    expect(outcome).toEqual({
      ok: false,
      reason: 'not-in-channel',
      remedy: expect.any(String),
    });
  });

  it('answers rate-limited at once, asking only once, when Discord answers 429', async () => {
    const discord = await startDiscord(() => ({
      status: 429,
      headers: { 'retry-after': '30' },
      body: {
        message: 'You are being rate limited.',
        retry_after: 30,
        global: false,
      },
    }));

    const { settled, ms } = await elapsedMs(() =>
      fetchConversation(discord.context, CONVERSATION_SOURCES, discordChannel, {
        threadRootId: null,
        requestMessageId: null,
        limit: 200,
      }),
    );

    expect(settled).toEqual({
      status: 'fulfilled',
      value: { ok: false, reason: 'rate-limited', remedy: null },
    });
    expect(ms).toBeLessThan(5_000);
    expect(discord.service.requests).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Mattermost
// ---------------------------------------------------------------------------

describe('Mattermost', () => {
  // Pins the upstream fault `CONVERSATION_SOURCES.mattermost` works around.
  // When this starts failing, the adapter sends a real query: the channel read
  // can be offered again.
  it('chat-adapter-mattermost sends the channel read with its query inside the path', async () => {
    const mattermostChannel = 'channelinb00000000000000000';
    const service = await serviceOf(() => ({
      status: 404,
      body: { message: 'not found' },
    }));
    const adapter = createMattermostAdapter({
      baseUrl: service.url,
      botToken: 'mattermost-bot-token',
    });

    await adapter
      .fetchChannelMessages(mattermostChannel, { limit: 200 })
      .catch(() => undefined);

    expect(service.requests.map((request) => request.path)).toEqual([
      `/api/v4/channels/${mattermostChannel}/posts%3Fpage=0&per_page=200`,
    ]);
  });
});
