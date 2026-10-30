// Which installation an event is placed in, read off REAL adapters with only
// the chat services' HTTP replaced by a local stand-in. What only a real
// adapter can show: that Slack's per-event bot token is still bound when the
// handler asks whose workspace it is (it is bound inside the adapter, and the
// handler runs later, past the Chat SDK's own dispatch), and which guild a
// Discord event's channel id carries -- or that a DM carries none.
//
// In `platform/` because only this layer may import the Chat SDK.
import { randomInt } from 'node:crypto';
import { createDiscordAdapter } from '@chat-adapter/discord';
import { SlackAdapter, type SlackAdapterConfig } from '@chat-adapter/slack';
import type { PostgresStateAdapter } from '@chat-adapter/state-pg';
import type { PlatformName } from '@growi/chat';
import { type Adapter, Chat } from 'chat';
import { mock } from 'vitest-mock-extended';

import type { PlatformAppConfig } from '../types/index.js';
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
import { identifyEventInstallation } from './event-installation.js';
import type { InstallationProvider } from './installation-provider.js';
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

// The Chat SDK de-duplicates incoming messages by id in the shared Postgres
// state, so a fixed id would be dropped from the second run on.
const unique = (): string => `${Date.now()}${randomInt(100_000, 999_999)}`;

const SLACK_TEAM = 'T0PLACED01';
const DISCORD_GUILD = '700000000000000777';

const HELD: Readonly<
  Record<
    PlatformName,
    ReadonlyArray<{ installationId: string; workspaceId: string }>
  >
> = {
  slack: [
    { installationId: 'inst-slack-other', workspaceId: 'T0OTHER001' },
    { installationId: 'inst-slack', workspaceId: SLACK_TEAM },
  ],
  discord: [{ installationId: 'inst-discord', workspaceId: DISCORD_GUILD }],
  teams: [],
  mattermost: [],
};

const installations = (): InstallationProvider =>
  mock<InstallationProvider>({
    list: async (platform) => HELD[platform],
    resolve: async (platform, workspaceId) =>
      platform === 'slack' && workspaceId === SLACK_TEAM
        ? { slack: { botToken: `xoxb-placed-${SLACK_TEAM}` } }
        : null,
  });

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

/** Registered as `platform/index.ts` registers an app-wide adapter, with the same identification. */
const listenOn = async (
  platform: PlatformName,
  adapter: Adapter,
  provider: InstallationProvider,
): Promise<{ caught: CaughtEvents; reported: unknown[] }> => {
  const caught = catchEvents();
  const reported: unknown[] = [];
  const chat = new Chat({
    adapters: { [adapter.name]: adapter },
    state,
    userName: BOT_USER_NAME,
  });
  registerEventHandlers(chat, {
    sink: caught.sink,
    modals: createModalTriggerRegistry(),
    identifyInstallation: identifyEventInstallation(
      { platform, factories: ADAPTER_FACTORIES, installations: provider },
      (_message, error) => reported.push(error),
    ),
  });
  await adapter.initialize(chat);
  return { caught, reported };
};

const serviceOf = async (
  responder: StandInResponder,
): Promise<ChatServiceStandIn> => {
  const service = await startChatServiceStandIn(responder);
  closers.push(service.close);
  return service;
};

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

/** Only the Socket Mode dial is replaced; envelopes go to `routeSocketEvent`. */
class SocketlessSlackAdapter extends SlackAdapter {
  protected override async startSocketMode(): Promise<void> {}

  deliver(
    envelope: Record<string, unknown>,
    type: 'events_api' | 'slash_commands' = 'events_api',
  ): Promise<void> {
    return this.routeSocketEvent(envelope, type, async () => {});
  }
}

const startSlack = async () => {
  const service = await serviceOf(({ path }) => {
    const method = path.replace(/^\/api\//, '');
    const answers: Record<string, () => unknown> = {
      'auth.test': () => ({
        ok: true,
        user_id: 'U0BOTPLACE',
        team_id: SLACK_TEAM,
        is_enterprise_install: false,
      }),
      'users.info': () => ({
        ok: true,
        user: { id: 'U0ALICE01', name: 'alice', real_name: 'Alice' },
      }),
    };
    return { body: answers[method]?.() ?? { ok: false, error: 'unknown' } };
  });
  const provider = installations();
  const config: SlackAdapterConfig = {
    mode: 'socket',
    appToken: 'xapp-1-test',
    signingSecret: 'signing-secret',
    installationProvider: createSlackInstallationLookup({
      installations: provider,
      fetch: (input, init) =>
        fetch(new URL(new URL(String(input)).pathname, service.url), init),
    }),
    apiUrl: `${service.url}/api/`,
    webClientOptions: { retryConfig: { retries: 0 } },
  };
  const adapter = new SocketlessSlackAdapter(config);
  return { adapter, ...(await listenOn('slack', adapter, provider)) };
};

describe('Slack', () => {
  it('places a DM, which no channel inventory lists, in the installation of the team the envelope names', async () => {
    const slack = await startSlack();

    await slack.adapter.deliver({
      type: 'event_callback',
      team_id: SLACK_TEAM,
      authorizations: [{ team_id: SLACK_TEAM, is_enterprise_install: false }],
      event_id: `Ev${unique()}`,
      event_time: Math.floor(Date.now() / 1000),
      event: {
        type: 'message',
        channel_type: 'im',
        channel: 'D0PLACED01',
        user: 'U0ALICE01',
        team: SLACK_TEAM,
        text: 'search foo',
        ts: `1700000001.${unique().slice(-6)}`,
      },
    });
    const event = await slack.caught.next();

    expect(slack.reported).toEqual([]);
    expect(event).toMatchObject({
      kind: 'mention',
      inDirectMessage: true,
      installation: { kind: 'identified', installationId: 'inst-slack' },
    });
  });

  it('reports, and leaves the event unplaced, when no bot token is bound to it', async () => {
    // An envelope naming no team gets no per-event token from the adapter,
    // which is what would happen to every event if the token stopped
    // reaching the handler.
    const slack = await startSlack();

    await slack.adapter.deliver({
      type: 'event_callback',
      event_id: `Ev${unique()}`,
      event_time: Math.floor(Date.now() / 1000),
      event: {
        type: 'message',
        channel_type: 'im',
        channel: 'D0PLACED01',
        user: 'U0ALICE01',
        text: 'search foo',
        ts: `1700000001.${unique().slice(-6)}`,
      },
    });
    const event = await slack.caught.next();

    expect(event.kind).toBe('mention');
    expect(event).not.toHaveProperty('installation');
    expect(slack.reported).toHaveLength(1);
  });

  it('places a slash command typed in a DM the same way', async () => {
    const slack = await startSlack();

    await slack.adapter.deliver(
      {
        command: '/growi',
        text: 'search foo',
        team_id: SLACK_TEAM,
        channel_id: 'D0PLACED01',
        channel_name: 'directmessage',
        user_id: 'U0ALICE01',
        user_name: 'alice',
        trigger_id: `trigger-${unique()}`,
        response_url: 'https://hooks.slack.test/commands/1',
      },
      'slash_commands',
    );
    const event = await slack.caught.next();

    expect(slack.reported).toEqual([]);
    expect(event).toMatchObject({
      kind: 'slash-command',
      installation: { kind: 'identified', installationId: 'inst-slack' },
    });
  });
});

// ---------------------------------------------------------------------------
// Discord
// ---------------------------------------------------------------------------

const DISCORD_APP = '900000000000000001';
const DISCORD_BOT_TOKEN = 'discord-bot-token';

const startDiscord = async () => {
  const service = await serviceOf(() => ({
    status: 404,
    body: { message: 'Unknown', code: 0 },
  }));
  const adapter = createDiscordAdapter({
    applicationId: DISCORD_APP,
    publicKey: 'a'.repeat(64),
    botToken: DISCORD_BOT_TOKEN,
    apiUrl: `${service.url}/api/v10`,
  });
  return { adapter, ...(await listenOn('discord', adapter, installations())) };
};

/** A Gateway MESSAGE_CREATE addressed to the bot, as the Gateway forwards it. */
const discordMention = (
  adapter: Adapter,
  place: { readonly guildId?: string; readonly channelId: string },
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
          channel_id: place.channelId,
          ...(place.guildId == null
            ? { channel_type: 1 }
            : { guild_id: place.guildId, channel_type: 0 }),
          author: { id: '920000000000000001', username: 'alice', bot: null },
          content: `<@${DISCORD_APP}> search foo`,
          timestamp: new Date().toISOString(),
          mentions: [{ id: DISCORD_APP }],
          attachments: [],
        },
      }),
    }),
  );

describe('Discord', () => {
  it('places a server channel message in the installation of its guild', async () => {
    const discord = await startDiscord();

    await discordMention(discord.adapter, {
      guildId: DISCORD_GUILD,
      channelId: '930000000000000777',
    });

    expect(await discord.caught.next()).toMatchObject({
      kind: 'mention',
      installation: { kind: 'identified', installationId: 'inst-discord' },
    });
  });

  it('says a DM belongs to no workspace, rather than placing it in some guild', async () => {
    const discord = await startDiscord();

    await discordMention(discord.adapter, { channelId: '910000000000000777' });

    expect(await discord.caught.next()).toMatchObject({
      kind: 'mention',
      inDirectMessage: true,
      installation: { kind: 'no-workspace' },
    });
  });

  it('leaves a message from a guild with no installation unplaced, for the inventory to try', async () => {
    const discord = await startDiscord();

    await discordMention(discord.adapter, {
      guildId: '700000000000000999',
      channelId: '930000000000000999',
    });
    const event = await discord.caught.next();

    expect(event.kind).toBe('mention');
    expect(event).not.toHaveProperty('installation');
  });
});
