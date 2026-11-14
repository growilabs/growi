// What a request event says about where it was made and what was asked, read
// off the four REAL adapters with only the chat services' HTTP (and, for
// Mattermost, its WebSocket) replaced by local stand-ins: the bot's own
// address is dropped from the text while a mention of another person stays,
// and a Slack DM made with the AI app view off is answered under the request
// message itself (Requirements 15.8, 15.14, 15.17).
//
// In `platform/` because only this layer may import the Chat SDK.
import { randomInt } from 'node:crypto';
import { createDiscordAdapter } from '@chat-adapter/discord';
import { SlackAdapter } from '@chat-adapter/slack';
import type { PostgresStateAdapter } from '@chat-adapter/state-pg';
import { TeamsAdapter } from '@chat-adapter/teams';
import { type Adapter, Chat } from 'chat';
import { createMattermostAdapter } from 'chat-adapter-mattermost';
import { mock } from 'vitest-mock-extended';

import type { PlatformAppConfig, PlatformEvent } from '../types/index.js';
import { createChatState } from './adapter-set.js';
import { BOT_USER_NAME } from './bot-factory.js';
import {
  type CaughtEvents,
  type ChatServiceStandIn,
  catchEvents,
  type StandInResponder,
  startChatServiceStandIn,
} from './chat-service-stand-in.js';
import { registerEventHandlers } from './event-handlers.js';
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

const mentionOf = (
  event: PlatformEvent,
): Extract<PlatformEvent, { kind: 'mention' }> => {
  if (event.kind !== 'mention') throw new Error(`got ${event.kind}`);
  return event;
};

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

  deliver(envelope: Record<string, unknown>): Promise<void> {
    return this.routeSocketEvent(envelope, 'events_api', async () => {});
  }
}

const SLACK_TEAM = 'T0ADDRESS1';
const SLACK_BOT_USER = 'U0BOT0002';
const SLACK_ALICE = 'U0ALICE02';
const SLACK_DM = 'D0DIRECT02';

const startSlack = async () => {
  const service = await serviceOf(({ path }) => {
    const method = path.replace(/^\/api\//, '');
    const answers: Record<string, () => unknown> = {
      'auth.test': () => ({
        ok: true,
        user_id: SLACK_BOT_USER,
        team_id: SLACK_TEAM,
        bot_id: 'B0BOT0002',
      }),
      'users.info': () => ({
        ok: true,
        user: {
          id: SLACK_ALICE,
          name: 'alice',
          real_name: 'Alice',
          profile: { display_name: 'alice', real_name: 'Alice' },
        },
      }),
    };
    return { body: answers[method]?.() ?? { ok: false, error: 'unknown' } };
  });
  const installations = mock<InstallationProvider>({
    list: async (platform) =>
      platform === 'slack'
        ? [{ installationId: 'installation-a', workspaceId: SLACK_TEAM }]
        : [],
    resolve: async (platform, workspaceId) =>
      platform === 'slack' && workspaceId === SLACK_TEAM
        ? { slack: { botToken: 'xoxb-installation-a' } }
        : null,
  });
  // Configured as `ADAPTER_FACTORIES.slack` configures it: the AI app view is
  // off, which is the default.
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
  const caught = await listenOn(adapter);
  return { adapter, caught };
};

const slackEnvelope = (event: Record<string, unknown>) => ({
  type: 'event_callback',
  team_id: SLACK_TEAM,
  authorizations: [{ team_id: SLACK_TEAM, is_enterprise_install: false }],
  event_id: `Ev${unique()}`,
  event_time: Math.floor(Date.now() / 1000),
  event: { user: SLACK_ALICE, team: SLACK_TEAM, ...event },
});

const slackTs = (): string => `1700000002.${unique().slice(-6)}`;

describe('Slack', () => {
  it('drops only its own address from a channel mention, keeping the person mentioned next', async () => {
    const slack = await startSlack();
    await slack.adapter.deliver(
      slackEnvelope({
        type: 'app_mention',
        channel: 'C0CHANNEL2',
        text: `<@${SLACK_BOT_USER}> <@${SLACK_ALICE}> please review`,
        ts: slackTs(),
      }),
    );

    expect(mentionOf(await slack.caught.next()).textWithoutBotAddress).toBe(
      '@alice please review',
    );
  });

  it('answers a DM request made with the AI app view off under the request message, and reads a reply in that thread as the same thread', async () => {
    const slack = await startSlack();
    const requestTs = slackTs();
    await slack.adapter.deliver(
      slackEnvelope({
        type: 'message',
        channel_type: 'im',
        channel: SLACK_DM,
        text: 'summarize this',
        ts: requestTs,
      }),
    );
    const request = mentionOf(await slack.caught.next());

    await slack.adapter.deliver(
      slackEnvelope({
        type: 'message',
        channel_type: 'im',
        channel: SLACK_DM,
        text: 'and the next one',
        ts: slackTs(),
        thread_ts: requestTs,
      }),
    );
    const reply = mentionOf(await slack.caught.next());

    expect(request).toMatchObject({
      messageId: requestTs,
      threadRootId: null,
      replyThreadRootId: requestTs,
      inDirectMessage: true,
    });
    expect(reply).toMatchObject({
      threadRootId: requestTs,
      replyThreadRootId: requestTs,
    });
  });
});

// ---------------------------------------------------------------------------
// Discord
// ---------------------------------------------------------------------------

const DISCORD_APP = '900000000000000002';
const DISCORD_BOT_TOKEN = 'discord-bot-token';
const DISCORD_DM = '910000000000000002';
const DISCORD_ALICE = '920000000000000002';

describe('Discord', () => {
  it('drops only its own <@application id> from a DM, keeping the person mentioned next', async () => {
    const service = await serviceOf(() => ({
      status: 404,
      body: { message: 'Unknown', code: 0 },
    }));
    // Configured as `ADAPTER_FACTORIES.discord` configures it, plus `apiUrl`.
    const adapter = createDiscordAdapter({
      applicationId: DISCORD_APP,
      publicKey: 'a'.repeat(64),
      botToken: DISCORD_BOT_TOKEN,
      apiUrl: `${service.url}/api/v10`,
    });
    const caught = await listenOn(adapter);

    await adapter.handleWebhook(
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
            author: { id: DISCORD_ALICE, username: 'alice', bot: null },
            content: `<@${DISCORD_APP}> <@${DISCORD_ALICE}> please review`,
            timestamp: new Date().toISOString(),
            mentions: [{ id: DISCORD_APP }, { id: DISCORD_ALICE }],
            attachments: [],
          },
        }),
      }),
    );

    expect(mentionOf(await caught.next()).textWithoutBotAddress).toBe(
      `<@${DISCORD_ALICE}> please review`,
    );
  });
});

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

const TEAMS_APP = '00000000-0000-0000-0000-00000000a98';
const TEAMS_TENANT = '00000000-0000-0000-0000-0000000000t2';
const TEAMS_DM = 'a:1directconversation2';
const TEAMS_APP_NAME = 'GROWI Wiki';

/** Only the inbound JWT check is skipped, through a pre-authenticated token. */
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

describe('Teams', () => {
  it("drops only the mention that names the app itself, under the app's display name, keeping the person mentioned next", async () => {
    const service = await serviceOf(() => ({ status: 404, body: {} }));
    const serviceUrl = `${service.url}/teams/`;
    const adapter = new DirectTeamsAdapter({
      appId: TEAMS_APP,
      // The Teams SDK decodes whatever token it is given, so it has to be
      // JWT-shaped; a password would make it fetch one from Microsoft.
      token: () =>
        [
          { alg: 'none', typ: 'JWT' },
          {
            aud: 'https://api.botframework.com',
            appid: TEAMS_APP,
            exp: Math.floor(Date.now() / 1000) + 3600,
          },
        ]
          .map((part) =>
            Buffer.from(JSON.stringify(part)).toString('base64url'),
          )
          .concat('signature')
          .join('.'),
      apiUrl: serviceUrl,
    });
    const caught = await listenOn(adapter);

    await adapter.receive(
      {
        type: 'message',
        id: unique(),
        channelId: 'msteams',
        serviceUrl,
        timestamp: new Date().toISOString(),
        from: { id: '29:1alice', name: 'Alice' },
        recipient: { id: `28:${TEAMS_APP}`, name: TEAMS_APP_NAME },
        conversation: {
          id: TEAMS_DM,
          conversationType: 'personal',
          tenantId: TEAMS_TENANT,
        },
        channelData: { tenant: { id: TEAMS_TENANT } },
        text: `<at>${TEAMS_APP_NAME}</at> <at>Alice</at> please review`,
        entities: [
          {
            type: 'mention',
            text: `<at>${TEAMS_APP_NAME}</at>`,
            mentioned: { id: `28:${TEAMS_APP}`, name: TEAMS_APP_NAME },
          },
          {
            type: 'mention',
            text: '<at>Alice</at>',
            mentioned: { id: '29:1alice', name: 'Alice' },
          },
        ],
      },
      serviceUrl,
    );
    const event = mentionOf(await caught.next());

    expect(event.textWithoutBotAddress).toBe('@Alice please review');
    // A Teams 1:1 conversation has no replies under a message to answer in.
    expect(event).toMatchObject({
      threadRootId: null,
      replyThreadRootId: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Mattermost
// ---------------------------------------------------------------------------

const MATTERMOST_DM = 'directchannel00000000000002';
const MATTERMOST_ALICE = 'aliceuserid000000000000002';

describe('Mattermost', () => {
  it('drops only @<its username from /users/me>, keeping the person mentioned next, and answers a DM under the request post', async () => {
    const service = await serviceOf(({ path }) =>
      path === '/api/v4/users/me'
        ? {
            body: { id: 'botuserid00000000000000002', username: BOT_USER_NAME },
          }
        : { status: 404, body: { message: 'not found' } },
    );
    // Configured as `ADAPTER_FACTORIES.mattermost` configures it.
    const adapter = createMattermostAdapter({
      baseUrl: service.url,
      botToken: 'mattermost-bot-token',
    });
    const caught = await listenOn(adapter);
    const postId = unique();

    try {
      service.push({
        event: 'posted',
        seq: 1,
        broadcast: { channel_id: MATTERMOST_DM },
        data: {
          channel_type: 'D',
          sender_name: '@alice',
          post: JSON.stringify({
            id: postId,
            channel_id: MATTERMOST_DM,
            user_id: MATTERMOST_ALICE,
            message: `@${BOT_USER_NAME} @alice please review`,
            create_at: Date.now(),
            edit_at: 0,
            delete_at: 0,
            type: '',
            root_id: '',
            props: {},
          }),
        },
      });
      const event = mentionOf(await caught.next());

      expect(event.textWithoutBotAddress).toBe('@alice please review');
      expect(event).toMatchObject({
        threadRootId: null,
        replyThreadRootId: postId,
      });
    } finally {
      // Before the stand-in closes, so the adapter stops reconnecting first.
      await adapter.disconnect();
    }
  });
});
