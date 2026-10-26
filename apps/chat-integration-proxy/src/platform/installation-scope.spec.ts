// A post this proxy makes on its own initiative -- a GROWI notification --
// arrives at the chat service with no incoming event behind it. The Slack
// adapter learns whose bot token to use only from such an event, so these
// tests drive the REAL adapter (a mocked one would not reproduce that) against
// a local stand-in for Slack's Web API, and read what actually reached it.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSlackAdapter } from '@chat-adapter/slack';
import type { PlatformName } from '@growi/chat';
import type { Adapter, StateAdapter } from 'chat';
import { mock } from 'vitest-mock-extended';

import {
  testSdkChannel,
  testSdkChannelId,
} from '../capabilities/test-channels.js';
import type {
  InstallationCredentials,
  OutboundMessage,
  SdkChannelRef,
} from '../types/index.js';
import { ADAPTER_FACTORIES } from './adapter-set.js';
import type { InstallationProvider } from './installation-provider.js';
import { installationRunner } from './installation-scope.js';
import { post } from './outbound.js';

interface ReceivedCall {
  readonly path: string;
  readonly authorization: string | undefined;
  readonly channel: string | null;
}

/** Slack's Web API, as far as `chat.postMessage` goes: records and answers ok. */
const startFakeSlack = async (): Promise<{
  readonly server: Server;
  readonly apiUrl: string;
  readonly calls: ReceivedCall[];
}> => {
  const calls: ReceivedCall[] = [];
  const readBody = async (request: IncomingMessage): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  };
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    const channel = request.headers['content-type']?.includes('json')
      ? ((JSON.parse(body) as { channel?: string }).channel ?? null)
      : new URLSearchParams(body).get('channel');
    calls.push({
      path: request.url ?? '',
      authorization: request.headers.authorization,
      channel,
    });
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        ok: true,
        channel,
        ts: `1700000000.00010${calls.length}`,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, apiUrl: `http://127.0.0.1:${port}/api/`, calls };
};

/**
 * Configured the way `ADAPTER_FACTORIES.slack` configures it -- socket mode,
 * no single-workspace `botToken`, workspaces resolved per event -- except for
 * where its Web API calls go.
 */
const multiWorkspaceSlackAdapter = (apiUrl: string): Adapter =>
  createSlackAdapter({
    mode: 'socket',
    appToken: 'xapp-1-test',
    signingSecret: 'signing-secret',
    installationProvider: { getInstallation: async () => null },
    apiUrl,
    webClientOptions: { retryConfig: { retries: 0 } },
  });

/** The proxy's installations: id -> (workspace, credentials). */
const installationsOf = (
  rows: Readonly<
    Record<
      string,
      {
        platform: PlatformName;
        workspaceId: string;
        credentials: InstallationCredentials | null;
      }
    >
  >,
): InstallationProvider =>
  mock<InstallationProvider>({
    list: async (platform) =>
      Object.entries(rows)
        .filter(([, row]) => row.platform === platform)
        .map(([installationId, row]) => ({
          installationId,
          workspaceId: row.workspaceId,
        })),
    resolve: async (platform, workspaceId) =>
      Object.values(rows).find(
        (row) => row.platform === platform && row.workspaceId === workspaceId,
      )?.credentials ?? null,
  });

const slackChannel = (nativeId: string): SdkChannelRef =>
  testSdkChannel('slack', {
    channelId: testSdkChannelId('slack', nativeId),
  });

const NOTIFICATION: OutboundMessage = {
  kind: 'markdown',
  markdown: '[Sandbox](https://wiki.example.com/Sandbox) が更新されました',
};

const INSTALLATIONS = installationsOf({
  'installation-x': {
    platform: 'slack',
    workspaceId: 'T0000000X',
    credentials: { slack: { botToken: 'xoxb-installation-x' } },
  },
  'installation-y': {
    platform: 'slack',
    workspaceId: 'T0000000Y',
    credentials: { slack: { botToken: 'xoxb-installation-y' } },
  },
  'installation-without-token': {
    platform: 'slack',
    workspaceId: 'T00000000',
    credentials: null,
  },
});

describe('a Slack post made outside any incoming event', () => {
  let fake: Awaited<ReturnType<typeof startFakeSlack>>;
  let adapter: Adapter;

  beforeEach(async () => {
    fake = await startFakeSlack();
    adapter = multiWorkspaceSlackAdapter(fake.apiUrl);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => fake.server.close(() => resolve()));
  });

  const postAs = (installationId: string | null, channel: SdkChannelRef) =>
    post(
      {
        adapter,
        state: mock<StateAdapter>(),
        botName: 'growi',
        run:
          installationId == null
            ? undefined
            : (installationRunner('slack', adapter, installationId, {
                installations: INSTALLATIONS,
                factories: ADAPTER_FACTORIES,
              }) ?? undefined),
      },
      channel,
      NOTIFICATION,
    );

  it('has no bot to speak as unless told which installation it is for', async () => {
    // What the rest of this block guards against: without this the tests
    // below could pass on an adapter that silently had a token of its own.
    const outcome = await postAs(null, slackChannel('C0000000X'));

    expect(outcome).toEqual({
      ok: false,
      reason: 'platform-error',
      detail: expect.stringContaining('No bot token available'),
    });
    expect(fake.calls).toEqual([]);
  });

  it("reaches chat.postMessage with that installation's own bot token", async () => {
    const outcome = await postAs('installation-x', slackChannel('C0000000X'));

    expect(outcome).toEqual({ ok: true, messageId: expect.any(String) });
    expect(fake.calls).toEqual([
      {
        path: '/api/chat.postMessage',
        authorization: 'Bearer xoxb-installation-x',
        channel: 'C0000000X',
      },
    ]);
  });

  it('keeps two installations posting at the same time each on its own token', async () => {
    const outcomes = await Promise.all([
      postAs('installation-x', slackChannel('C0000000X')),
      postAs('installation-y', slackChannel('C0000000Y')),
    ]);

    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(
      fake.calls
        .map(({ channel, authorization }) => ({ channel, authorization }))
        .sort((a, b) => String(a.channel).localeCompare(String(b.channel))),
    ).toEqual([
      { channel: 'C0000000X', authorization: 'Bearer xoxb-installation-x' },
      { channel: 'C0000000Y', authorization: 'Bearer xoxb-installation-y' },
    ]);
  });

  it('answers a platform error, sending nothing, for an installation this proxy does not hold', async () => {
    const outcome = await postAs(
      'installation-gone',
      slackChannel('C0000000X'),
    );

    expect(outcome).toEqual({
      ok: false,
      reason: 'platform-error',
      detail: expect.stringContaining('installation-gone'),
    });
    expect(fake.calls).toEqual([]);
  });

  it('answers a platform error, sending nothing, for an installation that carries no Slack bot token', async () => {
    const outcome = await postAs(
      'installation-without-token',
      slackChannel('C0000000X'),
    );

    expect(outcome).toEqual({
      ok: false,
      reason: 'platform-error',
      detail: expect.stringContaining('installation-without-token'),
    });
    expect(fake.calls).toEqual([]);
  });
});

describe('installationRunner on a service whose adapter already knows its bot', () => {
  // Discord and Teams speak with one app-wide token; Mattermost opens one
  // adapter per installation. None of them needs telling whose bot speaks.
  it.each<PlatformName>([
    'discord',
    'teams',
    'mattermost',
  ])('%s posts as it is, with no binding', (platform) => {
    expect(
      installationRunner(platform, mock<Adapter>(), 'installation-x', {
        installations: INSTALLATIONS,
        factories: ADAPTER_FACTORIES,
      }),
    ).toBeNull();
  });
});
