// What a conversation read answers once the service has replied: which
// messages come back and in which order, whether the read says older ones
// remain, how many it asks for per service, and -- when the service refuses --
// which reason the caller gets. The adapters are mocked at their boundary
// (the `fetch*` call); the services' own wire behaviour is covered by
// `conversation-history.integ.ts` and `conversation-history-facade.integ.ts`.
import type { PlatformName } from '@growi/chat';
import { type Adapter, Message, NotImplementedError } from 'chat';
import { mock } from 'vitest-mock-extended';

import { toSdkChannelId } from '../capabilities/index.js';
import type { SdkChannelRef } from '../types/index.js';
import {
  CONVERSATION_SOURCES,
  type ConversationReadContext,
  fetchConversation,
} from './conversation-history.js';
import type { InstallationProvider } from './installation-provider.js';

const CHANNEL_IDS: Readonly<Record<PlatformName, string>> = {
  slack: 'slack:C123',
  discord: 'discord:700000000000000001:930000000000000001',
  teams:
    'teams:MTk6Z2VuZXJhbEB0aHJlYWQudGFjdjI:aHR0cHM6Ly9zbWJhLnRyYWZmaWNtYW5hZ2VyLm5ldC9hbWVyLw',
  mattermost: 'channelinb00000000000000000',
};

const channelOf = (platform: PlatformName): SdkChannelRef => ({
  platform,
  channelId: toSdkChannelId(platform, CHANNEL_IDS[platform]),
  channelName: 'general',
  isPrivate: false,
});

/** `Required<Adapter>`: the SDK marks `fetchChannelMessages` optional. */
const adapterMock = () => mock<Required<Adapter>>();

const contextOf = (adapter: Adapter): ConversationReadContext => ({
  adapter,
  installationId: 'installation-x',
  installations: mock<InstallationProvider>(),
});

const messageOf = (
  id: string,
  iso: string,
  author: { readonly userId: string; readonly isMe?: boolean },
) =>
  new Message({
    id,
    threadId: 'thread',
    text: `text of ${id}`,
    formatted: { type: 'root', children: [] },
    raw: {},
    author: {
      userId: author.userId,
      userName: author.userId,
      fullName: `Name ${author.userId}`,
      isBot: author.isMe === true,
      isMe: author.isMe === true,
    },
    metadata: { dateSent: new Date(iso), edited: false },
    attachments: [],
  });

const RECENT = { threadRootId: null, requestMessageId: null, limit: 200 };

describe('fetchConversation', () => {
  it('returns the messages oldest first, with who wrote them', async () => {
    const adapter = adapterMock();
    adapter.fetchChannelMessages.mockResolvedValue({
      messages: [
        messageOf('m2', '2026-09-01T10:00:00.000Z', { userId: 'U2' }),
        messageOf('m1', '2026-09-01T09:00:00.000Z', { userId: 'U1' }),
      ],
    });

    const outcome = await fetchConversation(
      contextOf(adapter),
      CONVERSATION_SOURCES,
      channelOf('discord'),
      RECENT,
    );

    expect(outcome).toEqual({
      ok: true,
      truncated: false,
      messages: [
        {
          postedAt: '2026-09-01T09:00:00.000Z',
          author: {
            platform: 'discord',
            accountId: 'U1',
            displayName: 'Name U1',
          },
          text: 'text of m1',
        },
        {
          postedAt: '2026-09-01T10:00:00.000Z',
          author: {
            platform: 'discord',
            accountId: 'U2',
            displayName: 'Name U2',
          },
          text: 'text of m2',
        },
      ],
    });
  });

  it("leaves out the bot's own messages and the request itself", async () => {
    const adapter = adapterMock();
    adapter.fetchChannelMessages.mockResolvedValue({
      messages: [
        messageOf('m1', '2026-09-01T09:00:00.000Z', { userId: 'U1' }),
        messageOf('bot', '2026-09-01T09:30:00.000Z', {
          userId: 'B1',
          isMe: true,
        }),
        messageOf('request', '2026-09-01T10:00:00.000Z', { userId: 'U1' }),
      ],
    });

    const outcome = await fetchConversation(
      contextOf(adapter),
      CONVERSATION_SOURCES,
      channelOf('discord'),
      { ...RECENT, requestMessageId: 'request' },
    );

    expect(outcome.ok && outcome.messages.map((m) => m.text)).toEqual([
      'text of m1',
    ]);
  });

  it("leaves out only the bot's own messages when no request message is named", async () => {
    const adapter = adapterMock();
    adapter.fetchChannelMessages.mockResolvedValue({
      messages: [
        messageOf('m1', '2026-09-01T09:00:00.000Z', { userId: 'U1' }),
        messageOf('bot', '2026-09-01T09:30:00.000Z', {
          userId: 'B1',
          isMe: true,
        }),
        messageOf('request', '2026-09-01T10:00:00.000Z', { userId: 'U1' }),
      ],
    });

    const outcome = await fetchConversation(
      contextOf(adapter),
      CONVERSATION_SOURCES,
      channelOf('discord'),
      RECENT,
    );

    expect(outcome.ok && outcome.messages.map((m) => m.text)).toEqual([
      'text of m1',
      'text of request',
    ]);
  });

  it('says older messages remain when the service offers more', async () => {
    const adapter = adapterMock();
    adapter.fetchChannelMessages.mockResolvedValue({
      messages: [messageOf('m1', '2026-09-01T09:00:00.000Z', { userId: 'U1' })],
      nextCursor: 'older',
    });

    const outcome = await fetchConversation(
      contextOf(adapter),
      CONVERSATION_SOURCES,
      channelOf('mattermost'),
      RECENT,
    );

    expect(outcome).toMatchObject({ ok: true, truncated: true });
  });

  it('answers success with no messages when the place has none', async () => {
    const adapter = adapterMock();
    adapter.fetchChannelMessages.mockResolvedValue({ messages: [] });

    const outcome = await fetchConversation(
      contextOf(adapter),
      CONVERSATION_SOURCES,
      channelOf('teams'),
      RECENT,
    );

    expect(outcome).toEqual({ ok: true, messages: [], truncated: false });
  });

  it.each([
    ['discord', 200, 100],
    ['teams', 200, 50],
    ['mattermost', 200, 200],
    ['discord', 30, 30],
  ] as const)('asks %s for at most what it serves in one read (asked %i, sends %i)', async (platform, asked, sent) => {
    const adapter = adapterMock();
    adapter.fetchChannelMessages.mockResolvedValue({ messages: [] });

    await fetchConversation(
      contextOf(adapter),
      CONVERSATION_SOURCES,
      channelOf(platform),
      { ...RECENT, limit: asked },
    );

    expect(adapter.fetchChannelMessages).toHaveBeenCalledTimes(1);
    expect(adapter.fetchChannelMessages).toHaveBeenCalledWith(
      channelOf(platform).channelId,
      expect.objectContaining({ limit: sent }),
    );
  });

  it('answers unsupported when the adapter cannot read a channel at all', async () => {
    const adapter: Adapter = mock<Adapter>({ fetchChannelMessages: undefined });

    const outcome = await fetchConversation(
      contextOf(adapter),
      CONVERSATION_SOURCES,
      channelOf('discord'),
      RECENT,
    );

    expect(outcome).toEqual({ ok: false, reason: 'unsupported', remedy: null });
  });

  describe('a refused read', () => {
    /** The shape `@microsoft/teams.graph`'s `GraphError` takes. */
    const graphError = (statusCode: number) =>
      Object.assign(
        new Error(`Graph GET /teams failed with status ${statusCode}`),
        { name: 'GraphError', statusCode },
      );
    /** The shape `@chat-adapter/shared`'s `NetworkError` takes. */
    const networkError = (adapter: string, message: string) =>
      Object.assign(new Error(message), { name: 'NetworkError', adapter });

    it.each([
      [
        'Discord answering 429',
        'discord',
        networkError('discord', 'Discord API error: 429 {"retry_after":1.5}'),
        'rate-limited',
      ],
      ['Teams Graph answering 429', 'teams', graphError(429), 'rate-limited'],
      [
        'an adapter reporting its own rate limit',
        'mattermost',
        Object.assign(new Error('Rate limited by mattermost'), {
          name: 'AdapterRateLimitError',
          code: 'RATE_LIMITED',
        }),
        'rate-limited',
      ],
      ['Teams Graph answering 403', 'teams', graphError(403), 'not-permitted'],
      ['Teams Graph answering 404', 'teams', graphError(404), 'not-in-channel'],
      [
        'Teams turning a chat 403 into a missing-permission notice',
        'teams',
        new NotImplementedError(
          'Teams fetchMessages requires one of these Azure AD app permissions: ChatMessage.Read.Chat, Chat.Read.All, or Chat.Read.WhereInstalled',
          'fetchMessages',
        ),
        'not-permitted',
      ],
      [
        'an adapter that does not implement reading',
        'teams',
        new NotImplementedError('not here', 'fetchChannelMessages'),
        'unsupported',
      ],
      [
        'Discord answering 403',
        'discord',
        networkError('discord', 'Discord API error: 403 {"code":50001}'),
        'not-in-channel',
      ],
      [
        'Mattermost answering 403',
        'mattermost',
        Object.assign(new Error('forbidden'), {
          name: 'PermissionError',
          adapter: 'mattermost',
        }),
        'not-in-channel',
      ],
    ] as const)('%s answers %s', async (_label, platform, error, reason) => {
      const adapter = adapterMock();
      adapter.fetchChannelMessages.mockRejectedValue(error);

      const outcome = await fetchConversation(
        contextOf(adapter),
        CONVERSATION_SOURCES,
        channelOf(platform),
        RECENT,
      );

      expect(outcome).toMatchObject({ ok: false, reason });
    });

    it.each([
      ['not-in-channel', graphError(404)],
      ['not-permitted', graphError(403)],
    ] as const)('tells the reader what to do about %s', async (_reason, error) => {
      const adapter = adapterMock();
      adapter.fetchChannelMessages.mockRejectedValue(error);

      const outcome = await fetchConversation(
        contextOf(adapter),
        CONVERSATION_SOURCES,
        channelOf('teams'),
        RECENT,
      );

      expect(outcome).toMatchObject({ ok: false, remedy: expect.any(String) });
    });

    it('answers rate-limited without a remedy, since waiting is all there is to do', async () => {
      const adapter = adapterMock();
      adapter.fetchChannelMessages.mockRejectedValue(graphError(429));

      const outcome = await fetchConversation(
        contextOf(adapter),
        CONVERSATION_SOURCES,
        channelOf('teams'),
        RECENT,
      );

      expect(outcome).toEqual({
        ok: false,
        reason: 'rate-limited',
        remedy: null,
      });
    });

    it('lets a failure it cannot name propagate', async () => {
      const adapter = adapterMock();
      const dropped = new Error('socket hang up');
      adapter.fetchChannelMessages.mockRejectedValue(dropped);

      await expect(
        fetchConversation(
          contextOf(adapter),
          CONVERSATION_SOURCES,
          channelOf('discord'),
          RECENT,
        ),
      ).rejects.toBe(dropped);
    });
  });
});
