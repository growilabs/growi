// Facts the private-reply design rests on, read off the four REAL adapters with
// only the chat services' HTTP (and, for Mattermost, its WebSocket) replaced by
// local stand-ins: where a private message, a DM and a reaction actually go,
// whether the DM a bot opens is the channel a later DM event names, and what
// the start of a DM's text looks like (the input to the rule of 決定 P8 in the proxy research.md).
//
// This file lives in `platform/` because `architecture.spec.ts` lets only
// `platform/` import the Chat SDK, and pointing an adapter at a stand-in needs
// its constructor.
//
// Each stand-in answers what the service is known or, where marked, assumed to
// answer. A case whose outcome rests on an assumed answer rather than on
// adapter code says so in its name ("assuming ...").
import { randomInt, randomUUID } from 'node:crypto';
import { createDiscordAdapter } from '@chat-adapter/discord';
import { SlackAdapter, type SlackAdapterConfig } from '@chat-adapter/slack';
import type { PostgresStateAdapter } from '@chat-adapter/state-pg';
import { TeamsAdapter } from '@chat-adapter/teams';
import type { ChatAccountRef, PlatformName } from '@growi/chat';
import { type Adapter, Chat } from 'chat';
import { mock } from 'vitest-mock-extended';

import { parseSdkChannelId, toSdkChannelId } from '../capabilities/index.js';
import type {
  InstallationCredentials,
  OutboundMessage,
  PlatformAppConfig,
  PlatformEvent,
  SdkChannelRef,
} from '../types/index.js';
import { ADAPTER_FACTORIES, createChatState } from './adapter-set.js';
import { BOT_USER_NAME } from './bot-factory.js';
import {
  type CaughtEvents,
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
  addReaction,
  type OutboundContext,
  postDirect,
  postEphemeral,
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

// The Chat SDK de-duplicates incoming messages by id in the shared Postgres
// state, so a fixed id would be dropped from the second run on.
const unique = (): string => `${Date.now()}${randomInt(100_000, 999_999)}`;

const mentionOf = (
  event: PlatformEvent,
): Extract<PlatformEvent, { kind: 'mention' }> => {
  if (event.kind !== 'mention') throw new Error(`got ${event.kind}`);
  return event;
};

// ---------------------------------------------------------------------------
// One real adapter behind its own Chat instance, as `createPlatformFacade`
// builds it, but with the adapter pointed at a stand-in.
// ---------------------------------------------------------------------------

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

const listenOn = async (adapter: Adapter): Promise<CaughtEvents> => {
  const caught = catchEvents();
  const chat = new Chat({
    adapters: { [adapter.name]: adapter },
    state,
    userName: BOT_USER_NAME,
  });
  registerEventHandlers(chat, {
    sink: caught.sink,
    modals: createModalTriggerRegistry(),
  });
  await adapter.initialize(chat);
  return caught;
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

/**
 * Configured as `ADAPTER_FACTORIES.slack` configures it. Only the Socket Mode
 * dial is replaced (it would reach slack.com); the envelope it would deliver
 * is handed to the same `routeSocketEvent` the socket client calls.
 */
class SocketlessSlackAdapter extends SlackAdapter {
  protected override async startSocketMode(): Promise<void> {}

  deliver(envelope: Record<string, unknown>): Promise<void> {
    return this.routeSocketEvent(envelope, 'events_api', async () => {});
  }
}

const SLACK_TEAM = 'T0000000X';
const SLACK_BOT_USER = 'U0BOT0001';
const SLACK_DM = 'D0DIRECT01';

const slackInstallations = (): InstallationProvider =>
  mock<InstallationProvider>({
    list: async (platform) =>
      platform === 'slack'
        ? [{ installationId: 'installation-x', workspaceId: SLACK_TEAM }]
        : [],
    resolve: async (platform, workspaceId) =>
      platform === 'slack' && workspaceId === SLACK_TEAM
        ? { slack: { botToken: 'xoxb-installation-x' } }
        : null,
  });

const startSlack = async () => {
  let reactions = 0;
  const service = await serviceOf(({ path, body }) => {
    const method = path.replace(/^\/api\//, '');
    const answers: Record<string, () => unknown> = {
      'auth.test': () => ({
        ok: true,
        user_id: SLACK_BOT_USER,
        team_id: SLACK_TEAM,
        bot_id: 'B0BOT0001',
      }),
      'conversations.open': () => ({ ok: true, channel: { id: SLACK_DM } }),
      'chat.postMessage': () => ({
        ok: true,
        channel: (body as { channel?: string }).channel,
        ts: `1700000000.${unique().slice(-6)}`,
      }),
      'users.info': () => ({
        ok: true,
        user: {
          id: 'U0ALICE01',
          name: 'alice',
          real_name: 'Alice',
          profile: { display_name: 'alice', real_name: 'Alice' },
        },
      }),
      // Slack's documented answer to adding a reaction the bot already added.
      'reactions.add': () =>
        ++reactions === 1
          ? { ok: true }
          : { ok: false, error: 'already_reacted' },
    };
    return { body: answers[method]?.() ?? { ok: false, error: 'unknown' } };
  });
  const installations = slackInstallations();
  const apiUrl = `${service.url}/api/`;
  const config: SlackAdapterConfig = {
    mode: 'socket',
    appToken: 'xapp-1-test',
    signingSecret: 'signing-secret',
    // `auth.test` for the bot user id is made by this app's own lookup, which
    // calls slack.com directly; it is sent to the stand-in instead.
    installationProvider: createSlackInstallationLookup({
      installations,
      fetch: (input, init) =>
        fetch(new URL(new URL(String(input)).pathname, service.url), init),
    }),
    apiUrl,
    webClientOptions: { retryConfig: { retries: 0 } },
  };
  const adapter = new SocketlessSlackAdapter(config);
  const caught = await listenOn(adapter);
  const run =
    installationRunner('slack', adapter, 'installation-x', {
      installations,
      factories: ADAPTER_FACTORIES,
    }) ?? undefined;
  return { service, adapter, caught, context: contextOf(adapter, run) };
};

const slackDirectMessage = (text: string) => ({
  type: 'event_callback',
  team_id: SLACK_TEAM,
  authorizations: [{ team_id: SLACK_TEAM, is_enterprise_install: false }],
  event_id: `Ev${unique()}`,
  event_time: Math.floor(Date.now() / 1000),
  // What Slack sends for a message typed into the bot's Messages tab: a
  // `message` event (never `app_mention`) with `channel_type: im`.
  event: {
    type: 'message',
    channel_type: 'im',
    channel: SLACK_DM,
    user: 'U0ALICE01',
    team: SLACK_TEAM,
    text,
    ts: `1700000001.${unique().slice(-6)}`,
  },
});

describe('Slack', () => {
  it('names the same channel for the DM the bot opens and for a message typed into it', async () => {
    const slack = await startSlack();

    const sent = await postDirect(
      slack.context,
      channelRef('slack', 'slack:C0000000X'),
      person('slack', 'U0ALICE01'),
      REPLY,
    );
    await slack.adapter.deliver(slackDirectMessage('search foo'));
    const event = mentionOf(await slack.caught.next());

    expect(sent).toEqual({
      ok: true,
      messageId: expect.any(String),
      channel: expect.objectContaining({ channelId: `slack:${SLACK_DM}` }),
    });
    expect(event.channel.channelId).toBe(sent.ok && sent.channel.channelId);
    expect(event.inDirectMessage).toBe(true);
    expect(parseSdkChannelId('slack', event.channel.channelId)).toBeDefined();
    expect(slack.service.requests.map((r) => r.path)).toEqual(
      expect.arrayContaining([
        '/api/conversations.open',
        '/api/chat.postMessage',
      ]),
    );
  });

  it('leaves the text of an unaddressed DM as typed', async () => {
    const slack = await startSlack();
    await slack.adapter.deliver(slackDirectMessage('search foo'));

    expect(mentionOf(await slack.caught.next()).text).toBe('search foo');
  });

  it("puts the bot's user id, not its name, in front of a DM that addresses the bot", async () => {
    const slack = await startSlack();
    await slack.adapter.deliver(
      slackDirectMessage(`<@${SLACK_BOT_USER}> search foo`),
    );

    expect(mentionOf(await slack.caught.next()).text).toBe(
      `@${SLACK_BOT_USER} search foo`,
    );
  });

  it('hands Slack a link on its own line in markdown autolink form, localhost included', async () => {
    const slack = await startSlack();

    await postEphemeral(
      slack.context,
      channelRef('slack', 'slack:C0000000X'),
      person('slack', 'U0ALICE01'),
      {
        kind: 'markdown',
        markdown: 'Open this:\n\n<http://localhost:3000/link/abc>',
      },
    );

    const sent = slack.service.requests.find(
      (r) => r.path === '/api/chat.postEphemeral',
    );
    expect((sent?.body as { markdown_text?: string }).markdown_text).toBe(
      'Open this:\n\n<http://localhost:3000/link/abc>',
    );
  });

  it('answers success when the same reaction is added twice (already_reacted)', async () => {
    const slack = await startSlack();
    const target = {
      channel: channelRef('slack', 'slack:C0000000X'),
      messageId: '1700000000.000100',
    };

    const outcomes = [
      await addReaction(slack.context, target, 'email'),
      await addReaction(slack.context, target, 'email'),
    ];

    expect(outcomes).toEqual([{ ok: true }, { ok: true }]);
    expect(
      slack.service.requests
        .filter((r) => r.path === '/api/reactions.add')
        .map((r) => (r.body as { name?: string }).name),
    ).toEqual(['email', 'email']);
  });
});

// ---------------------------------------------------------------------------
// Discord
// ---------------------------------------------------------------------------

const DISCORD_APP = '900000000000000001';
const DISCORD_BOT_TOKEN = 'discord-bot-token';
const DISCORD_DM = '910000000000000001';

const startDiscord = async () => {
  const service = await serviceOf(({ method, path }) => {
    if (path === '/api/v10/users/@me/channels') {
      return { body: { id: DISCORD_DM, type: 1 } };
    }
    if (method === 'POST' && /\/messages$/.test(path)) {
      return { body: { id: unique(), channel_id: DISCORD_DM } };
    }
    // Discord refuses to start a thread in a DM channel.
    if (/\/threads$/.test(path)) {
      return {
        status: 400,
        body: { message: 'Cannot execute action on a DM channel', code: 50003 },
      };
    }
    // Assumed: 204 to PUT .../reactions/<emoji>/@me, also on a repeat.
    if (method === 'PUT' && path.includes('/reactions/'))
      return { status: 204 };
    return { status: 404, body: { message: 'Unknown', code: 0 } };
  });
  // Configured as `ADAPTER_FACTORIES.discord` configures it, plus `apiUrl`.
  const adapter = createDiscordAdapter({
    applicationId: DISCORD_APP,
    publicKey: 'a'.repeat(64),
    botToken: DISCORD_BOT_TOKEN,
    apiUrl: `${service.url}/api/v10`,
  });
  const caught = await listenOn(adapter);
  return { service, adapter, caught, context: contextOf(adapter) };
};

/** A Gateway MESSAGE_CREATE in a DM: no `guild_id`, channel type 1. */
const discordDirectMessage = (
  adapter: Adapter,
  content: string,
  mentions: ReadonlyArray<{ id: string }>,
) =>
  adapter.handleWebhook(
    new Request('http://proxy.test/webhooks/discord', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-discord-gateway-token': DISCORD_BOT_TOKEN,
      },
      body: JSON.stringify({
        type: 'GATEWAY_MESSAGE_CREATE',
        timestamp: Date.now(),
        data: {
          id: unique(),
          channel_id: DISCORD_DM,
          channel_type: 1,
          author: { id: '920000000000000001', username: 'alice', bot: null },
          content,
          timestamp: new Date().toISOString(),
          mentions,
          attachments: [],
        },
      }),
    }),
  );

describe('Discord', () => {
  it('answers unsupported for a private message, sending nothing (no SDK fallback to a DM)', async () => {
    const discord = await startDiscord();

    const outcome = await postEphemeral(
      discord.context,
      channelRef('discord', 'discord:700000000000000001:930000000000000001'),
      person('discord', '920000000000000001'),
      REPLY,
    );

    expect(outcome).toEqual({ ok: false, reason: 'unsupported' });
    expect(discord.service.requests).toEqual([]);
  });

  it('names the same channel for the DM the bot opens and for a message typed into it', async () => {
    const discord = await startDiscord();

    const sent = await postDirect(
      discord.context,
      channelRef('discord', 'discord:700000000000000001:930000000000000001'),
      person('discord', '920000000000000001'),
      REPLY,
    );
    await discordDirectMessage(discord.adapter, 'search foo', []);
    const event = mentionOf(await discord.caught.next());

    expect(sent).toEqual({
      ok: true,
      messageId: expect.any(String),
      channel: expect.objectContaining({
        channelId: `discord:@me:${DISCORD_DM}`,
      }),
    });
    expect(event.channel.channelId).toBe(sent.ok && sent.channel.channelId);
    expect(event.inDirectMessage).toBe(true);
    expect(parseSdkChannelId('discord', event.channel.channelId)).toBeDefined();
  });

  it('leaves the text of an unaddressed DM as typed', async () => {
    const discord = await startDiscord();
    await discordDirectMessage(discord.adapter, 'search foo', []);

    expect(mentionOf(await discord.caught.next()).text).toBe('search foo');
  });

  it('keeps a DM that addresses the bot as Discord sent it (<@application id>), in the same DM channel', async () => {
    const discord = await startDiscord();
    await discordDirectMessage(
      discord.adapter,
      `<@${DISCORD_APP}> search foo`,
      [{ id: DISCORD_APP }],
    );
    const event = mentionOf(await discord.caught.next());

    expect(event.text).toBe(`<@${DISCORD_APP}> search foo`);
    expect(event.channel.channelId).toBe(`discord:@me:${DISCORD_DM}`);
  });

  it('answers success when the same reaction is added twice, assuming Discord answers 204 both times', async () => {
    const discord = await startDiscord();
    const target = {
      channel: channelRef(
        'discord',
        'discord:700000000000000001:930000000000000001',
      ),
      messageId: '940000000000000001',
    };

    const outcomes = [
      await addReaction(discord.context, target, 'email'),
      await addReaction(discord.context, target, 'email'),
    ];

    expect(outcomes).toEqual([{ ok: true }, { ok: true }]);
    const put =
      'PUT /api/v10/channels/930000000000000001/messages/940000000000000001/reactions/%F0%9F%93%A7/@me';
    expect(
      discord.service.requests.map((r) => `${r.method} ${r.path}`),
    ).toEqual([put, put]);
  });
});

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

const TEAMS_APP = '00000000-0000-0000-0000-00000000a99';
const TEAMS_TENANT = '00000000-0000-0000-0000-0000000000t1';
const TEAMS_USER = '29:1alice';
const TEAMS_DM = 'a:1directconversation';

/**
 * Delivers an activity to the adapter's own registered handlers. Only the
 * inbound JWT check is skipped -- it fetches Bot Framework's signing keys --
 * through the pre-authenticated `token` the Teams SDK accepts from a trusted
 * transport.
 */
class DirectTeamsAdapter extends TeamsAdapter {
  async receive(activity: object, serviceUrl: string): Promise<void> {
    await this.app.process({
      body: activity as Parameters<typeof this.app.process>[0]['body'],
      token: {
        appId: TEAMS_APP,
        serviceUrl,
        from: 'azure',
        fromId: 'https://api.botframework.com',
        isExpired: () => false,
        toString: () => 'pre-authenticated',
      },
    });
  }
}

const startTeams = async (reactionStatus = 200) => {
  const service = await serviceOf(({ method, path }) => {
    if (method === 'POST' && path === '/teams/v3/conversations') {
      return { body: { id: TEAMS_DM } };
    }
    if (method === 'POST' && path.endsWith('/activities')) {
      return { body: { id: unique() } };
    }
    if (method === 'PUT' && path.includes('/reactions/')) {
      return { status: reactionStatus, body: {} };
    }
    return { status: 404, body: {} };
  });
  const serviceUrl = `${service.url}/teams/`;
  // `ADAPTER_FACTORIES.teams` passes `appId` / `appPassword`; a password would
  // make the Teams SDK fetch a token from login.microsoftonline.com. The SDK
  // decodes whatever token it is given, so it has to be JWT-shaped.
  const adapter = new DirectTeamsAdapter({
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
  const caught = await listenOn(adapter);
  return { service, serviceUrl, adapter, caught, context: contextOf(adapter) };
};

const teamsActivity = (
  serviceUrl: string,
  conversation: { id: string; conversationType: string },
  text: string,
  addressed: boolean,
) => ({
  type: 'message',
  id: unique(),
  channelId: 'msteams',
  serviceUrl,
  timestamp: new Date().toISOString(),
  from: { id: TEAMS_USER, name: 'Alice' },
  recipient: { id: `28:${TEAMS_APP}`, name: BOT_USER_NAME },
  conversation: { ...conversation, tenantId: TEAMS_TENANT },
  channelData: { tenant: { id: TEAMS_TENANT } },
  text,
  entities: addressed
    ? [
        {
          type: 'mention',
          text: `<at>${BOT_USER_NAME}</at>`,
          mentioned: { id: `28:${TEAMS_APP}`, name: BOT_USER_NAME },
        },
      ]
    : [],
});

const TEAMS_CHANNEL_CONVERSATION = {
  id: '19:general@thread.tacv2',
  conversationType: 'channel',
};
const TEAMS_DM_CONVERSATION = { id: TEAMS_DM, conversationType: 'personal' };

const teamsDirectMessageTarget = (serviceUrl: string) => ({
  channel: channelRef(
    'teams',
    `teams:${Buffer.from(TEAMS_DM).toString('base64url')}:${Buffer.from(serviceUrl).toString('base64url')}`,
  ),
  messageId: '1700000000001',
});

/** Teams opens a DM only for a user it has seen: the tenant comes from that. */
const teamsAfterFirstMention = async () => {
  const teams = await startTeams();
  await teams.adapter.receive(
    teamsActivity(
      teams.serviceUrl,
      TEAMS_CHANNEL_CONVERSATION,
      `<at>${BOT_USER_NAME}</at> help`,
      true,
    ),
    teams.serviceUrl,
  );
  const { channel } = mentionOf(await teams.caught.next());
  return { ...teams, channel };
};

describe('Teams', () => {
  it('names the same channel for the DM the bot opens and for a message typed into it', async () => {
    const teams = await teamsAfterFirstMention();

    const sent = await postDirect(
      teams.context,
      teams.channel,
      person('teams', TEAMS_USER),
      REPLY,
    );
    await teams.adapter.receive(
      teamsActivity(
        teams.serviceUrl,
        TEAMS_DM_CONVERSATION,
        'search foo',
        false,
      ),
      teams.serviceUrl,
    );
    const event = mentionOf(await teams.caught.next());

    expect(sent).toEqual({
      ok: true,
      messageId: expect.any(String),
      channel: expect.objectContaining({ channelId: expect.any(String) }),
    });
    expect(event.channel.channelId).toBe(sent.ok && sent.channel.channelId);
    expect(event.inDirectMessage).toBe(true);
    expect(parseSdkChannelId('teams', event.channel.channelId)).toBeDefined();
  });

  it('leaves the text of an unaddressed DM as typed', async () => {
    const teams = await startTeams();
    await teams.adapter.receive(
      teamsActivity(
        teams.serviceUrl,
        TEAMS_DM_CONVERSATION,
        'search foo',
        false,
      ),
      teams.serviceUrl,
    );

    expect(mentionOf(await teams.caught.next()).text).toBe('search foo');
  });

  // The <at> text is the app's display name in Teams; `growi` is only what
  // this stand-in activity carries.
  it("puts @<the app's display name in Teams> (the <at> text) in front of a DM that addresses the bot", async () => {
    const teams = await startTeams();
    await teams.adapter.receive(
      teamsActivity(
        teams.serviceUrl,
        TEAMS_DM_CONVERSATION,
        `<at>${BOT_USER_NAME}</at> search foo`,
        true,
      ),
      teams.serviceUrl,
    );

    expect(mentionOf(await teams.caught.next()).text).toBe(
      `@${BOT_USER_NAME} search foo`,
    );
  });

  // Teams documents its reaction types as like, heart, 1f440_eyes,
  // 2705_whiteheavycheckmark, launch and 1f4cc_pushpin; the adapter's alias
  // table has no entry for email, so whether Teams accepts the type it sends
  // cannot be told from here.
  it('sends eyes as the documented 1f440_eyes, but email unmapped as "email"', async () => {
    const teams = await startTeams();
    const target = teamsDirectMessageTarget(teams.serviceUrl);

    await addReaction(teams.context, target, 'email');
    await addReaction(teams.context, target, 'eyes');

    const base = `PUT /teams/v3/conversations/${TEAMS_DM}/activities/1700000000001/reactions`;
    expect(teams.service.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `${base}/email`,
      `${base}/1f440_eyes`,
    ]);
  });

  it('answers success when the same reaction is added twice, assuming Teams answers 200 both times', async () => {
    const teams = await startTeams();
    const target = teamsDirectMessageTarget(teams.serviceUrl);

    const outcomes = [
      await addReaction(teams.context, target, 'eyes'),
      await addReaction(teams.context, target, 'eyes'),
    ];

    expect(outcomes).toEqual([{ ok: true }, { ok: true }]);
  });

  it('answers a failure, without throwing, when Teams refuses the reaction, assuming Teams answers 400', async () => {
    const teams = await startTeams(400);
    const target = teamsDirectMessageTarget(teams.serviceUrl);

    expect(await addReaction(teams.context, target, 'email')).toEqual({
      ok: false,
      detail: expect.any(String),
    });
  });
});

// ---------------------------------------------------------------------------
// Mattermost, through the real facade with two installations open
// ---------------------------------------------------------------------------

const MATTERMOST_CHANNEL = 'channelinb00000000000000000';
const MATTERMOST_DM = 'directchannel00000000000000';
const ALICE = 'aliceuserid000000000000000';

const startMattermost = async (botUserId: string) => {
  let reactions = 0;
  return await serviceOf(({ method, path }) => {
    if (path === '/api/v4/users/me') {
      return { body: { id: botUserId, username: BOT_USER_NAME } };
    }
    if (path === '/api/v4/posts/ephemeral') {
      // What Mattermost answers a bot without the `create_post_ephemeral`
      // permission (it needs system administrator).
      return {
        status: 403,
        body: {
          id: 'api.context.permissions.app_error',
          message: 'You do not have the appropriate permissions.',
          status_code: 403,
        },
      };
    }
    if (method === 'POST' && path === '/api/v4/channels/direct') {
      return { status: 201, body: { id: MATTERMOST_DM, type: 'D' } };
    }
    if (method === 'POST' && path === '/api/v4/posts') {
      return {
        status: 201,
        body: { id: unique(), channel_id: MATTERMOST_DM, root_id: '' },
      };
    }
    // Assumed: a repeated reaction answers 200 again.
    if (method === 'POST' && path === '/api/v4/reactions') {
      reactions += 1;
      return { body: { user_id: botUserId, emoji_name: 'email', reactions } };
    }
    return { status: 404, body: { message: 'not found' } };
  });
};

const mattermostDirectPost = (text: string) => ({
  event: 'posted',
  seq: 1,
  broadcast: { channel_id: MATTERMOST_DM },
  data: {
    channel_type: 'D',
    sender_name: '@alice',
    post: JSON.stringify({
      id: unique(),
      channel_id: MATTERMOST_DM,
      user_id: ALICE,
      message: text,
      create_at: Date.now(),
      edit_at: 0,
      delete_at: 0,
      type: '',
      root_id: '',
      props: {},
    }),
  },
});

describe('Mattermost, with two installations open', () => {
  let facade: PlatformFacade;
  let serverA: ChatServiceStandIn;
  let serverB: ChatServiceStandIn;
  let caught: CaughtEvents;
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
    caught = catchEvents();
    facade = await createPlatformFacade(APP_CONFIG, installations, caught.sink);
    await facade.connections().reconcile();
  });

  // Before the stand-ins close, so the adapters stop reconnecting first.
  afterEach(() => facade.shutdown());

  const channel = (): SdkChannelRef =>
    channelRef('mattermost', MATTERMOST_CHANNEL);
  const alice = person('mattermost', ALICE);
  const pathsOf = (server: ChatServiceStandIn) =>
    server.requests.map((r) => `${r.method} ${r.path}`);

  it('opened both installations over their WebSocket', () => {
    expect(pathsOf(serverA)).toEqual(['GET /api/v4/users/me']);
    expect(pathsOf(serverB)).toEqual(['GET /api/v4/users/me']);
  });

  it('cannot tell which server to address without a scope, and sends nothing', async () => {
    const outcome = await facade.postEphemeral(channel(), alice, REPLY);

    expect(outcome).toEqual({
      ok: false,
      reason: 'platform-error',
      detail: expect.stringContaining('mattermost'),
    });
    expect(pathsOf(serverA)).toEqual(['GET /api/v4/users/me']);
    expect(pathsOf(serverB)).toEqual(['GET /api/v4/users/me']);
  });

  it("reaches /posts/ephemeral with the proxy's bare channel id, through the scoped installation only", async () => {
    const outcome = await facade.postEphemeral(channel(), alice, REPLY, {
      installationId: installationB,
    });

    const ephemeral = serverB.requests.find(
      (r) => r.path === '/api/v4/posts/ephemeral',
    );
    expect(ephemeral).toEqual({
      method: 'POST',
      path: '/api/v4/posts/ephemeral',
      authorization: 'Bearer token-b',
      body: {
        user_id: ALICE,
        post: expect.objectContaining({ channel_id: MATTERMOST_CHANNEL }),
      },
    });
    // The 403 is an answer, not a throw, and the facade does not turn to a DM
    // by itself.
    expect(outcome).toEqual({
      ok: false,
      reason: 'platform-error',
      detail: expect.stringMatching(
        /may lack the permission to post private messages/,
      ),
    });
    expect(pathsOf(serverB)).not.toContain('POST /api/v4/channels/direct');
    expect(pathsOf(serverA)).toEqual(['GET /api/v4/users/me']);
  });

  it('after a 403 on /posts/ephemeral, a DM through the same scope reaches /channels/direct and /posts on that installation', async () => {
    await facade.postEphemeral(channel(), alice, REPLY, {
      installationId: installationB,
    });
    const sent = await facade.postDirect(channel(), alice, REPLY, {
      installationId: installationB,
    });

    expect(sent).toEqual({
      ok: true,
      messageId: expect.any(String),
      channel: expect.objectContaining({ channelId: MATTERMOST_DM }),
    });
    expect(
      serverB.requests.find((r) => r.path === '/api/v4/channels/direct'),
    ).toEqual(
      expect.objectContaining({
        authorization: 'Bearer token-b',
        body: ['botinstallationb0000000000', ALICE],
      }),
    );
    expect(pathsOf(serverB)).toContain('POST /api/v4/posts');
    expect(pathsOf(serverA)).toEqual(['GET /api/v4/users/me']);
  });

  it('names the same channel for the DM the bot opens and for a message typed into it', async () => {
    const sent = await facade.postDirect(channel(), alice, REPLY, {
      installationId: installationB,
    });
    serverB.push(mattermostDirectPost('search foo'));
    const event = mentionOf(await caught.next());

    expect(event.channel.channelId).toBe(sent.ok && sent.channel.channelId);
    expect(event.inDirectMessage).toBe(true);
    expect(event.text).toBe('search foo');
    expect(
      parseSdkChannelId('mattermost', event.channel.channelId),
    ).toBeDefined();
  });

  // `growi` is installation B's username from /users/me in this stand-in. The
  // adapter never rewrites a post's text, so the leading name is whatever the
  // user typed; the rule (決定 P8) decides by shape (`@word` / `<@...>`) because the command
  // layer has no bot identity to compare it with.
  it("leaves a DM that addresses the bot as typed: @<the bot account's username from /users/me> in front", async () => {
    serverB.push(mattermostDirectPost(`@${BOT_USER_NAME} search foo`));

    expect(mentionOf(await caught.next()).text).toBe(
      `@${BOT_USER_NAME} search foo`,
    );
  });

  it('answers success when the same reaction is added twice, assuming Mattermost answers 200 both times', async () => {
    const target = {
      channel: channel(),
      messageId: 'requestpost0000000000000000',
    };
    const scope = { installationId: installationB };

    const outcomes = [
      await facade.addReaction(target, 'email', scope),
      await facade.addReaction(target, 'email', scope),
    ];

    expect(outcomes).toEqual([{ ok: true }, { ok: true }]);
    expect(
      serverB.requests
        .filter((r) => r.path === '/api/v4/reactions')
        .map((r) => r.body),
    ).toEqual([
      {
        emoji_name: 'email',
        post_id: 'requestpost0000000000000000',
        user_id: 'botinstallationb0000000000',
      },
      {
        emoji_name: 'email',
        post_id: 'requestpost0000000000000000',
        user_id: 'botinstallationb0000000000',
      },
    ]);
  });
});
