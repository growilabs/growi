// The two DM behaviors that `private-reply-adapters.integ.ts` and
// `event-addressing-adapters.integ.ts` check with the Slack AI app view off,
// checked again with it ON: the DM the bot opens is the channel a typed
// message comes back in, and a DM request is answered under the request
// message, a reply in that thread reading as the same thread. Real Slack
// adapter, only its HTTP and Socket Mode dial replaced.
import { randomInt } from 'node:crypto';
import { SlackAdapter } from '@chat-adapter/slack';
import type { PostgresStateAdapter } from '@chat-adapter/state-pg';
import type { ChatAccountRef } from '@growi/chat';
import { Chat } from 'chat';
import { mock } from 'vitest-mock-extended';

import { toSdkChannelId } from '../capabilities/index.js';
import type {
  OutboundMessage,
  PlatformAppConfig,
  PlatformEvent,
  SdkChannelRef,
} from '../types/index.js';
import { ADAPTER_FACTORIES, createChatState } from './adapter-set.js';
import { BOT_USER_NAME } from './bot-factory.js';
import {
  type ChatServiceStandIn,
  catchEvents,
  startChatServiceStandIn,
} from './chat-service-stand-in.js';
import { registerEventHandlers } from './event-handlers.js';
import type { InstallationProvider } from './installation-provider.js';
import { installationRunner } from './installation-scope.js';
import { postDirect } from './outbound.js';
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

const unique = (): string => `${Date.now()}${randomInt(100_000, 999_999)}`;
const slackTs = (): string => `1700000003.${unique().slice(-6)}`;

const SLACK_TEAM = 'T0AGENTVW1';
const SLACK_BOT_USER = 'U0BOT0003';
const SLACK_ALICE = 'U0ALICE03';
const SLACK_DM = 'D0DIRECT03';
const REPLY: OutboundMessage = { kind: 'markdown', markdown: 'reply body' };

class SocketlessSlackAdapter extends SlackAdapter {
  protected override async startSocketMode(): Promise<void> {}

  deliver(envelope: Record<string, unknown>): Promise<void> {
    return this.routeSocketEvent(envelope, 'events_api', async () => {});
  }
}

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

const startSlack = async (agentView: boolean) => {
  const service: ChatServiceStandIn = await startChatServiceStandIn(
    ({ path, body }) => {
      const method = path.replace(/^\/api\//, '');
      const answers: Record<string, () => unknown> = {
        'auth.test': () => ({
          ok: true,
          user_id: SLACK_BOT_USER,
          team_id: SLACK_TEAM,
          bot_id: 'B0BOT0003',
        }),
        'conversations.open': () => ({ ok: true, channel: { id: SLACK_DM } }),
        'chat.postMessage': () => ({
          ok: true,
          channel: (body as { channel?: string }).channel,
          ts: slackTs(),
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
    },
  );
  closers.push(service.close);
  const installations = mock<InstallationProvider>({
    list: async () => [
      { installationId: 'installation-v', workspaceId: SLACK_TEAM },
    ],
    resolve: async () => ({ slack: { botToken: 'xoxb-installation-v' } }),
  });
  const adapter = new SocketlessSlackAdapter({
    mode: 'socket',
    appToken: 'xapp-1-test',
    signingSecret: 'signing-secret',
    agentView,
    installationProvider: createSlackInstallationLookup({
      installations,
      fetch: (input, init) =>
        fetch(new URL(new URL(String(input)).pathname, service.url), init),
    }),
    apiUrl: `${service.url}/api/`,
    webClientOptions: { retryConfig: { retries: 0 } },
  });
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
  const run =
    installationRunner('slack', adapter, 'installation-v', {
      installations,
      factories: ADAPTER_FACTORIES,
    }) ?? undefined;
  return {
    adapter,
    caught,
    context: {
      adapter,
      state,
      botName: BOT_USER_NAME,
      ...(run == null ? {} : { run }),
    },
  };
};

const dmEnvelope = (event: Record<string, unknown>) => ({
  type: 'event_callback',
  team_id: SLACK_TEAM,
  authorizations: [{ team_id: SLACK_TEAM, is_enterprise_install: false }],
  event_id: `Ev${unique()}`,
  event_time: Math.floor(Date.now() / 1000),
  event: {
    type: 'message',
    channel_type: 'im',
    channel: SLACK_DM,
    user: SLACK_ALICE,
    team: SLACK_TEAM,
    ...event,
  },
});

const alice: ChatAccountRef = {
  platform: 'slack',
  accountId: SLACK_ALICE,
  displayName: 'Alice',
};
const workspaceChannel: SdkChannelRef = {
  platform: 'slack',
  channelId: toSdkChannelId('slack', 'slack:C0AGENTVW1'),
  channelName: 'general',
  isPrivate: false,
};

describe.each([
  ['off', false],
  ['on', true],
])('a Slack DM with the AI app view %s', (_label, agentView) => {
  it('is the same channel for the DM the bot opens and for a message typed into it', async () => {
    const slack = await startSlack(agentView);

    const sent = await postDirect(
      slack.context,
      workspaceChannel,
      alice,
      REPLY,
    );
    await slack.adapter.deliver(
      dmEnvelope({ text: 'search foo', ts: slackTs() }),
    );
    const event = mentionOf(await slack.caught.next());

    expect(sent).toMatchObject({
      ok: true,
      channel: { channelId: `slack:${SLACK_DM}` },
    });
    expect(event.channel.channelId).toBe(sent.ok && sent.channel.channelId);
    expect(event.inDirectMessage).toBe(true);
    expect(event.text).toBe('search foo');
  });

  it('is answered under the request message, and a reply in that thread reads as the same thread', async () => {
    const slack = await startSlack(agentView);
    const requestTs = slackTs();
    await slack.adapter.deliver(
      dmEnvelope({ text: 'summarize this', ts: requestTs }),
    );
    const request = mentionOf(await slack.caught.next());

    await slack.adapter.deliver(
      dmEnvelope({
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
