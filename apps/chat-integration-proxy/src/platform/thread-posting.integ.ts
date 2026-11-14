// Where a thread root ends up on the wire, per service, read off the four REAL
// adapters with only the chat services' HTTP replaced by local stand-ins:
// posting into a thread, and posting something only one person sees into one.
// Lives in `platform/` because only that layer may import the Chat SDK.
import { randomInt, randomUUID } from 'node:crypto';
import { createDiscordAdapter } from '@chat-adapter/discord';
import { SlackAdapter } from '@chat-adapter/slack';
import type { PostgresStateAdapter } from '@chat-adapter/state-pg';
import { TeamsAdapter } from '@chat-adapter/teams';
import type { ChatAccountRef, PlatformName } from '@growi/chat';
import { type Adapter, Chat } from 'chat';
import { mock } from 'vitest-mock-extended';

import { toSdkChannelId } from '../capabilities/index.js';
import type {
  InstallationCredentials,
  OutboundMessage,
  PlatformAppConfig,
  SdkChannelRef,
} from '../types/index.js';
import { ADAPTER_FACTORIES, createChatState } from './adapter-set.js';
import { BOT_USER_NAME } from './bot-factory.js';
import {
  type ChatServiceStandIn,
  catchEvents,
  type StandInResponder,
  startChatServiceStandIn,
} from './chat-service-stand-in.js';
import { registerEventHandlers } from './event-handlers.js';
import { createPlatformFacade, type PlatformFacade } from './index.js';
import type { InstallationProvider } from './installation-provider.js';
import { installationRunner } from './installation-scope.js';
import {
  type OutboundContext,
  postEphemeral,
  postInThread,
} from './outbound.js';
import { createModalTriggerRegistry } from './prompt.js';
import { createSlackInstallationLookup } from './slack-installation-lookup.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy';
const APP_CONFIG: PlatformAppConfig = {
  stateConnectionString:
    process.env.CHAT_SDK_DATABASE_URL ??
    `${DATABASE_URL}?options=-c%20search_path%3Dchat_sdk`,
};

const REPLY: OutboundMessage = { kind: 'markdown', markdown: 'reply body' };
const unique = (): string => `${Date.now()}${randomInt(100_000, 999_999)}`;

let state: PostgresStateAdapter;
const closers: Array<() => Promise<void>> = [];

beforeAll(async () => {
  state = createChatState(APP_CONFIG);
  await state.connect();
});

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

afterAll(async () => {
  await state.disconnect();
});

const initialize = async (adapter: Adapter): Promise<void> => {
  const chat = new Chat({
    adapters: { [adapter.name]: adapter },
    state,
    userName: BOT_USER_NAME,
  });
  registerEventHandlers(chat, {
    sink: catchEvents().sink,
    modals: createModalTriggerRegistry(),
  });
  await adapter.initialize(chat);
};

const contextOf = (
  adapter: Adapter,
  run?: OutboundContext['run'],
): OutboundContext => ({
  adapter,
  state,
  botName: BOT_USER_NAME,
  ...(run == null ? {} : { run }),
});

const serviceOf = async (
  responder: StandInResponder,
): Promise<ChatServiceStandIn> => {
  const service = await startChatServiceStandIn(responder);
  closers.push(service.close);
  return service;
};

const person = (platform: PlatformName, accountId: string): ChatAccountRef => ({
  platform,
  accountId,
  displayName: 'Alice',
});

const channelRef = (
  platform: PlatformName,
  channelId: string,
): SdkChannelRef => ({
  platform,
  channelId: toSdkChannelId(platform, channelId),
  channelName: 'general',
  isPrivate: false,
});

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

class SocketlessSlackAdapter extends SlackAdapter {
  protected override async startSocketMode(): Promise<void> {}
}

const SLACK_TEAM = 'T0000000X';
const SLACK_BOT_USER = 'U0BOT0001';
const SLACK_CHANNEL = 'C0000000X';
const SLACK_ROOT = '1700000000.000100';

const startSlack = async (postFailure?: string) => {
  const service = await serviceOf(({ path }) => {
    const method = path.replace(/^\/api\//, '');
    if (postFailure != null && method.startsWith('chat.post')) {
      return { body: { ok: false, error: postFailure } };
    }
    const answers: Record<string, () => unknown> = {
      'auth.test': () => ({
        ok: true,
        user_id: SLACK_BOT_USER,
        team_id: SLACK_TEAM,
        bot_id: 'B0BOT0001',
      }),
      'chat.postMessage': () => ({
        ok: true,
        channel: SLACK_CHANNEL,
        ts: `1700000000.${unique().slice(-6)}`,
      }),
      'chat.postEphemeral': () => ({
        ok: true,
        message_ts: `1700000000.${unique().slice(-6)}`,
      }),
    };
    return { body: answers[method]?.() ?? { ok: false, error: 'unknown' } };
  });
  const installations = mock<InstallationProvider>({
    list: async () => [
      { installationId: 'installation-x', workspaceId: SLACK_TEAM },
    ],
    resolve: async () => ({ slack: { botToken: 'xoxb-installation-x' } }),
  });
  const adapter = new SocketlessSlackAdapter({
    mode: 'socket',
    appToken: 'xapp-1-test',
    signingSecret: 'signing-secret',
    installationProvider: createSlackInstallationLookup({
      installations,
      fetch: (input, init) =>
        fetch(new URL(new URL(String(input)).pathname, service.url), init),
    }),
    apiUrl: `${service.url}/api/`,
    webClientOptions: { retryConfig: { retries: 0 } },
  });
  await initialize(adapter);
  const run =
    installationRunner('slack', adapter, 'installation-x', {
      installations,
      factories: ADAPTER_FACTORIES,
    }) ?? undefined;
  return { service, context: contextOf(adapter, run) };
};

const bodyOf = (
  service: ChatServiceStandIn,
  path: string,
): Record<string, unknown> | undefined =>
  service.requests.find((r) => r.path === path)?.body as
    | Record<string, unknown>
    | undefined;

describe('Slack', () => {
  const channel = channelRef('slack', `slack:${SLACK_CHANNEL}`);

  it('posts into the thread the root names', async () => {
    const slack = await startSlack();

    const outcome = await postInThread(
      slack.context,
      channel,
      SLACK_ROOT,
      REPLY,
    );

    expect(outcome).toEqual({ ok: true, messageId: expect.any(String) });
    expect(bodyOf(slack.service, '/api/chat.postMessage')).toMatchObject({
      channel: SLACK_CHANNEL,
      thread_ts: SLACK_ROOT,
    });
  });

  it('shows a private message in the thread the root names, and in the channel when no root is given', async () => {
    const slack = await startSlack();
    const alice = person('slack', 'U0ALICE01');

    const inThread = await postEphemeral(
      slack.context,
      channel,
      alice,
      REPLY,
      SLACK_ROOT,
    );
    const inChannel = await postEphemeral(slack.context, channel, alice, REPLY);

    expect([inThread, inChannel]).toEqual([
      { ok: true, messageId: expect.any(String) },
      { ok: true, messageId: expect.any(String) },
    ]);
    const sent = slack.service.requests
      .filter((r) => r.path === '/api/chat.postEphemeral')
      .map((r) => r.body as Record<string, unknown>);
    expect(sent[0]).toMatchObject({ user: 'U0ALICE01', thread_ts: SLACK_ROOT });
    expect(sent[1]).toMatchObject({ user: 'U0ALICE01' });
    expect(sent[1]).not.toHaveProperty('thread_ts');
  });

  it('answers that the bot is not in the channel, without throwing', async () => {
    const slack = await startSlack('not_in_channel');

    const outcome = await postInThread(
      slack.context,
      channel,
      SLACK_ROOT,
      REPLY,
    );

    expect(outcome).toMatchObject({ ok: false, reason: 'bot-not-in-channel' });
  });
});

// ---------------------------------------------------------------------------
// Discord
// ---------------------------------------------------------------------------

const DISCORD_CHANNEL = 'discord:700000000000000001:930000000000000001';
const DISCORD_THREAD = '950000000000000001';

const startDiscord = async () => {
  const service = await serviceOf(({ method, path }) =>
    method === 'POST' && /\/messages$/.test(path)
      ? { body: { id: unique(), channel_id: DISCORD_THREAD } }
      : { status: 404, body: { message: 'Unknown', code: 0 } },
  );
  const adapter = createDiscordAdapter({
    applicationId: '900000000000000001',
    publicKey: 'a'.repeat(64),
    botToken: 'discord-bot-token',
    apiUrl: `${service.url}/api/v10`,
  });
  await initialize(adapter);
  return { service, context: contextOf(adapter) };
};

describe('Discord', () => {
  it('posts into the thread channel the root names', async () => {
    const discord = await startDiscord();

    const outcome = await postInThread(
      discord.context,
      channelRef('discord', DISCORD_CHANNEL),
      DISCORD_THREAD,
      REPLY,
    );

    expect(outcome).toEqual({ ok: true, messageId: expect.any(String) });
    expect(
      discord.service.requests.map((r) => `${r.method} ${r.path}`),
    ).toEqual([`POST /api/v10/channels/${DISCORD_THREAD}/messages`]);
  });

  it('answers unsupported for a private message in a thread, sending nothing', async () => {
    const discord = await startDiscord();

    const outcome = await postEphemeral(
      discord.context,
      channelRef('discord', DISCORD_CHANNEL),
      person('discord', '920000000000000001'),
      REPLY,
      DISCORD_THREAD,
    );

    expect(outcome).toEqual({ ok: false, reason: 'unsupported' });
    expect(discord.service.requests).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

const TEAMS_APP = '00000000-0000-0000-0000-00000000a99';
const TEAMS_CHANNEL_CONVERSATION = '19:general@thread.tacv2';
const TEAMS_ROOT = '1700000000001';

const startTeams = async () => {
  const service = await serviceOf(({ method, path }) =>
    method === 'POST' && path.endsWith('/activities')
      ? { body: { id: unique() } }
      : { status: 404, body: {} },
  );
  const serviceUrl = `${service.url}/teams/`;
  const adapter = new TeamsAdapter({
    appId: TEAMS_APP,
    token: () =>
      [
        { alg: 'none', typ: 'JWT' },
        {
          aud: 'https://api.botframework.com',
          appid: TEAMS_APP,
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
      ]
        .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
        .concat('signature')
        .join('.'),
    apiUrl: serviceUrl,
  });
  await initialize(adapter);
  const channelId = adapter.encodeThreadId({
    conversationId: TEAMS_CHANNEL_CONVERSATION,
    conversationType: 'channel',
    serviceUrl,
  });
  return {
    service,
    channel: channelRef('teams', channelId),
    context: contextOf(adapter),
  };
};

const activityPaths = (service: ChatServiceStandIn): string[] =>
  service.requests.map((r) => `${r.method} ${decodeURIComponent(r.path)}`);

describe('Teams', () => {
  it('posts into the conversation whose ;messageid= is the root', async () => {
    const teams = await startTeams();

    const outcome = await postInThread(
      teams.context,
      teams.channel,
      TEAMS_ROOT,
      REPLY,
    );

    expect(outcome).toEqual({ ok: true, messageId: expect.any(String) });
    expect(activityPaths(teams.service)).toEqual([
      `POST /teams/v3/conversations/${TEAMS_CHANNEL_CONVERSATION};messageid=${TEAMS_ROOT}/activities`,
    ]);
  });

  it('shows a private message in the conversation whose ;messageid= is the root, and in the channel when no root is given', async () => {
    const teams = await startTeams();
    const alice = person('teams', '29:1alice');

    await postEphemeral(teams.context, teams.channel, alice, REPLY, TEAMS_ROOT);
    await postEphemeral(teams.context, teams.channel, alice, REPLY);

    expect(activityPaths(teams.service)).toEqual([
      `POST /teams/v3/conversations/${TEAMS_CHANNEL_CONVERSATION};messageid=${TEAMS_ROOT}/activities?isTargetedActivity=true`,
      `POST /teams/v3/conversations/${TEAMS_CHANNEL_CONVERSATION}/activities?isTargetedActivity=true`,
    ]);
  });
});

// ---------------------------------------------------------------------------
// Mattermost, through the real facade with two installations open
// ---------------------------------------------------------------------------

const MATTERMOST_CHANNEL = 'channelinb00000000000000000';
const MATTERMOST_ROOT = 'rootpost000000000000000000';
const ALICE = 'aliceuserid000000000000000';

const startMattermost = async (botUserId: string) =>
  await serviceOf(({ method, path }) => {
    if (path === '/api/v4/users/me') {
      return { body: { id: botUserId, username: BOT_USER_NAME } };
    }
    if (
      method === 'POST' &&
      (path === '/api/v4/posts' || path === '/api/v4/posts/ephemeral')
    ) {
      return {
        status: 201,
        body: { id: unique(), channel_id: MATTERMOST_CHANNEL, root_id: '' },
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

describe('Mattermost, with two installations open', () => {
  let facade: PlatformFacade;
  let serverA: ChatServiceStandIn;
  let serverB: ChatServiceStandIn;
  const installationA = randomUUID();
  const installationB = randomUUID();

  beforeEach(async () => {
    serverA = await startMattermost('botinstallationa0000000000');
    serverB = await startMattermost('botinstallationb0000000000');
    const credentialsOf: Record<string, InstallationCredentials> = {
      'team-a': { mattermost: { baseUrl: serverA.url, botToken: 'token-a' } },
      'team-b': { mattermost: { baseUrl: serverB.url, botToken: 'token-b' } },
    };
    const installations = mock<InstallationProvider>({
      list: async (platform) =>
        platform === 'mattermost'
          ? [
              { installationId: installationA, workspaceId: 'team-a' },
              { installationId: installationB, workspaceId: 'team-b' },
            ]
          : [],
      resolve: async (platform, workspaceId) =>
        platform === 'mattermost' ? (credentialsOf[workspaceId] ?? null) : null,
    });
    facade = await createPlatformFacade(
      APP_CONFIG,
      installations,
      catchEvents().sink,
    );
    await facade.connections().reconcile();
  });

  afterEach(() => facade.shutdown());

  const channel = (): SdkChannelRef =>
    channelRef('mattermost', MATTERMOST_CHANNEL);
  const postsOf = (server: ChatServiceStandIn, path: string) =>
    server.requests.filter((r) => r.path === path);

  it('posts into the root post thread through the installation named, and nowhere else', async () => {
    const outcome = await facade.postInThread(
      channel(),
      MATTERMOST_ROOT,
      REPLY,
      { installationId: installationB },
    );

    expect(outcome).toEqual({ ok: true, messageId: expect.any(String) });
    expect(postsOf(serverB, '/api/v4/posts')).toEqual([
      expect.objectContaining({
        authorization: 'Bearer token-b',
        body: expect.objectContaining({
          channel_id: MATTERMOST_CHANNEL,
          root_id: MATTERMOST_ROOT,
        }),
      }),
    ]);
    expect(postsOf(serverA, '/api/v4/posts')).toEqual([]);
  });

  it('shows a private message in the root post thread through the installation named', async () => {
    const outcome = await facade.postEphemeral(
      channel(),
      person('mattermost', ALICE),
      REPLY,
      { installationId: installationB, threadRootId: MATTERMOST_ROOT },
    );

    expect(outcome).toEqual({ ok: true, messageId: expect.any(String) });
    expect(postsOf(serverB, '/api/v4/posts/ephemeral')).toEqual([
      expect.objectContaining({
        body: {
          user_id: ALICE,
          post: expect.objectContaining({ root_id: MATTERMOST_ROOT }),
        },
      }),
    ]);
    expect(postsOf(serverA, '/api/v4/posts/ephemeral')).toEqual([]);
  });

  it('answers a failure, without sending, when no open connection can be told to serve the call', async () => {
    const outcome = await facade.postInThread(
      channel(),
      MATTERMOST_ROOT,
      REPLY,
      { installationId: randomUUID() },
    );

    expect(outcome).toMatchObject({ ok: false, reason: 'platform-error' });
    expect(postsOf(serverA, '/api/v4/posts')).toEqual([]);
    expect(postsOf(serverB, '/api/v4/posts')).toEqual([]);
  });
});
