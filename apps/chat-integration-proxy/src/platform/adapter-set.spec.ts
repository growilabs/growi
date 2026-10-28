// Task 3.1: 「接続情報を受け取ってアダプタと state を組み立てる」.
//
// What is asserted here is the *observable contract* of the assembly step:
// which of the 4 services end up with an adapter for a given
// `PlatformAppConfig` / `InstallationCredentials`, and that the iteration is
// driven by the declared registry rather than by a chain of
// `if (platform === 'slack')`. The Chat SDK's own adapter behavior is not
// re-tested here -- it is third-party code.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DiscordAdapter } from '@chat-adapter/discord';
import { createSlackAdapter, type SlackAdapter } from '@chat-adapter/slack';
import type { PlatformName } from '@growi/chat';
import type { Adapter } from 'chat';
import { mock } from 'vitest-mock-extended';

import type {
  InstallationCredentials,
  PlatformAppConfig,
} from '../types/index.js';
import type { AdapterFactory, AppAdapterContext } from './adapter-set.js';
import {
  ADAPTER_FACTORIES,
  createAppAdapters,
  createChatState,
  createInstallationAdapter,
} from './adapter-set.js';
import type { InstallationProvider } from './installation-provider.js';

const FULL_APP_CONFIG: PlatformAppConfig = {
  slack: {
    signingSecret: 'signing-secret',
    clientId: 'slack-client-id',
    clientSecret: 'slack-client-secret',
    appToken: 'xapp-1-test',
  },
  discord: {
    applicationId: 'discord-app-id',
    publicKey: '0'.repeat(64),
    clientSecret: 'discord-client-secret',
    botToken: 'discord-bot-token',
  },
  teams: { clientId: 'teams-client-id', clientSecret: 'teams-client-secret' },
  stateConnectionString: 'postgres://user:pw@postgres:5432/chat_sdk',
};

const CONTEXT: AppAdapterContext = {
  installations: mock<InstallationProvider>(),
};

describe('ADAPTER_FACTORIES (the declared registry)', () => {
  it('declares exactly one entry per chat service, so adding a service is a one-file change', () => {
    const platforms: readonly PlatformName[] = [
      'slack',
      'discord',
      'teams',
      'mattermost',
    ];

    expect(Object.keys(ADAPTER_FACTORIES).sort()).toEqual(
      [...platforms].sort(),
    );
  });

  it('says where each service reads its credentials from -- app-wide for slack/discord/teams, per installation for mattermost', () => {
    // design.md: 「アプリごとの接続は `PlatformAppConfig` から開き、installation
    // ごとの接続は `InstallationCredentials` から開く」. Mattermost is the only
    // service whose connection target itself differs per installation.
    const sources = Object.fromEntries(
      Object.entries(ADAPTER_FACTORIES).map(([platform, factory]) => [
        platform,
        factory.credentialSource,
      ]),
    );

    expect(sources).toEqual({
      slack: 'app',
      discord: 'app',
      teams: 'app',
      mattermost: 'installation',
    });
  });
});

describe('createAppAdapters', () => {
  it('builds an adapter for every service the app config carries credentials for', () => {
    const adapters = createAppAdapters(
      FULL_APP_CONFIG,
      ADAPTER_FACTORIES,
      CONTEXT,
    );

    expect(Object.keys(adapters).sort()).toEqual(
      ['discord', 'slack', 'teams'].sort(),
    );
  });

  it('builds no adapter for a service the app config does not configure', () => {
    // A deployment that only runs Slack simply has no `discord` / `teams`
    // block -- this is `PlatformAppConfig`'s optional fields doing the
    // filtering, not the capability table.
    const { discord, teams, ...slackOnly } = FULL_APP_CONFIG;

    const adapters = createAppAdapters(slackOnly, ADAPTER_FACTORIES, CONTEXT);

    expect(Object.keys(adapters)).toEqual(['slack']);
  });

  it('never builds an app-wide adapter for mattermost, whose connection target is per installation', () => {
    const adapters = createAppAdapters(
      FULL_APP_CONFIG,
      ADAPTER_FACTORIES,
      CONTEXT,
    );

    expect(adapters.mattermost).toBeUndefined();
  });

  it('reads the registry it is handed rather than a hard-coded service list', () => {
    // The point of passing the work-set in (.claude/rules/coding-style.md,
    // "executors take their work-set as input"): a caller can substitute the
    // whole registry, which is also what makes this function testable without
    // constructing a real Chat SDK adapter.
    const substitute = mock<Adapter>();
    const factories: Readonly<Record<PlatformName, AdapterFactory>> = {
      slack: { credentialSource: 'app', create: () => null },
      discord: { credentialSource: 'app', create: () => substitute },
      teams: { credentialSource: 'app', create: () => null },
      mattermost: { credentialSource: 'installation', create: () => null },
    };

    const adapters = createAppAdapters(FULL_APP_CONFIG, factories, CONTEXT);

    expect(adapters).toEqual({ discord: substitute });
  });
});

describe('createInstallationAdapter', () => {
  const credentials: InstallationCredentials = {
    mattermost: {
      baseUrl: 'https://mattermost.example.com',
      botToken: 'mattermost-bot-token',
    },
  };

  it('builds a mattermost adapter from that installation own connection target', () => {
    expect(
      createInstallationAdapter('mattermost', credentials, ADAPTER_FACTORIES),
    ).not.toBeNull();
  });

  it('builds nothing when the installation carries no credentials for that service', () => {
    expect(
      createInstallationAdapter('mattermost', {}, ADAPTER_FACTORIES),
    ).toBeNull();
  });

  it('builds nothing for a service whose credentials are app-wide, so it cannot be opened per installation', () => {
    expect(
      createInstallationAdapter(
        'slack',
        { slack: { botToken: 'xoxb-1' } },
        ADAPTER_FACTORIES,
      ),
    ).toBeNull();
  });
});

describe('createChatState', () => {
  it('opens the Chat SDK state against the connection string it is given, not an auto-detected environment variable', async () => {
    // Implementation Note 1.2: `createPostgresState()` auto-detects
    // POSTGRES_URL / DATABASE_URL. This app deliberately keeps the SDK's
    // connection separate (`CHAT_SDK_DATABASE_URL`, `search_path=chat_sdk`),
    // so relying on auto-detect would write the SDK's lock and subscription
    // tables into this app's own Prisma database. Reading the pool's
    // connection string back is the only way to observe that the value was
    // actually used -- a state adapter that silently fell back to the
    // environment would otherwise look identical here.
    const state = createChatState(FULL_APP_CONFIG);

    expect(state.getClient().options.connectionString).toBe(
      FULL_APP_CONFIG.stateConnectionString,
    );
    await state.disconnect();
  });
});

describe("Slack's workspace of the event being handled", () => {
  // Driven through the REAL adapter against a local stand-in for Slack's Web
  // API: what is under test is that the adapter's own per-event client (the
  // token `withBotToken` binds here, as an incoming event does in production)
  // is what gets asked, and how its answer maps onto `installation.workspace_id`.
  let server: Server;
  let apiUrl: string;
  const answers = new Map<string, Record<string, unknown>>();
  const askedWith: Array<string | undefined> = [];

  beforeEach(async () => {
    answers.clear();
    askedWith.length = 0;
    server = createServer((request, response) => {
      const authorization = request.headers.authorization;
      askedWith.push(authorization);
      request.resume();
      request.on('end', () => {
        const token = authorization?.replace(/^Bearer /, '') ?? '';
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify(
            request.url?.endsWith('/auth.test')
              ? (answers.get(token) ?? { ok: false, error: 'invalid_auth' })
              : { ok: false, error: 'unknown_method' },
          ),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const slackAdapter = (): SlackAdapter =>
    createSlackAdapter({
      mode: 'socket',
      appToken: 'xapp-1-test',
      signingSecret: 'signing-secret',
      installationProvider: { getInstallation: async () => null },
      apiUrl,
    });

  const workspaceOfEventAs = (botToken: string): Promise<string> => {
    const factory = ADAPTER_FACTORIES.slack;
    if (
      factory.credentialSource !== 'app' ||
      factory.workspaceOfEvent == null
    ) {
      throw new Error(
        'Slack declares no way to read the workspace of an event',
      );
    }
    const read = factory.workspaceOfEvent;
    const adapter = slackAdapter();
    return adapter.withBotToken(botToken, () => read(adapter));
  };

  it('answers the team for a workspace install, asked with the bot token of the event', async () => {
    answers.set('xoxb-team', {
      ok: true,
      team_id: 'T2',
      user_id: 'UBOT',
      is_enterprise_install: false,
    });

    await expect(workspaceOfEventAs('xoxb-team')).resolves.toBe('T2');
    expect(askedWith).toEqual(['Bearer xoxb-team']);
  });

  it('answers the enterprise for an org-wide install, the key the OAuth callback stores it under', async () => {
    answers.set('xoxb-org', {
      ok: true,
      team_id: 'T9',
      enterprise_id: 'E1',
      user_id: 'UBOT',
      is_enterprise_install: true,
    });

    await expect(workspaceOfEventAs('xoxb-org')).resolves.toBe('E1');
  });

  it('fails rather than guessing when Slack refuses the token', async () => {
    await expect(workspaceOfEventAs('xoxb-revoked')).rejects.toThrow();
  });

  it('fails rather than guessing when Slack names no workspace', async () => {
    answers.set('xoxb-odd', { ok: true, user_id: 'UBOT' });

    await expect(workspaceOfEventAs('xoxb-odd')).rejects.toThrow();
  });
});

describe('listener windows (services that must be told to start listening)', () => {
  it('only Discord declares one: Slack listens as soon as its adapter is initialized, Teams dials in, Mattermost connects per installation', () => {
    const declared = Object.fromEntries(
      Object.entries(ADAPTER_FACTORIES).map(([platform, factory]) => [
        platform,
        factory.credentialSource === 'app' &&
          factory.startListenerWindow != null,
      ]),
    );

    expect(declared).toEqual({
      slack: false,
      discord: true,
      teams: false,
      mattermost: false,
    });
  });

  describe("Discord's Gateway window", () => {
    const discordFactory = ADAPTER_FACTORIES.discord;
    const startWindow =
      discordFactory.credentialSource === 'app'
        ? discordFactory.startListenerWindow
        : undefined;
    const buildAdapter = (): Adapter => {
      const adapter = createAppAdapters(
        FULL_APP_CONFIG,
        ADAPTER_FACTORIES,
        CONTEXT,
      ).discord;
      if (adapter == null) throw new Error('discord adapter not built');
      return adapter;
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('fails to open when the adapter was never initialized with its Chat instance', async () => {
      const adapter = buildAdapter();

      await expect(
        startWindow?.(adapter, 1_000, new AbortController().signal),
      ).rejects.toThrow(/500/);
    });

    it('asks the adapter to listen for the window, stoppable by the signal, handling events itself rather than forwarding them', async () => {
      const adapter = buildAdapter();
      if (!(adapter instanceof DiscordAdapter)) throw new Error('not discord');
      let endListening: () => void = () => undefined;
      const listen = vi
        .spyOn(adapter, 'startGatewayListener')
        .mockImplementation((options) => {
          options.waitUntil?.(
            new Promise<void>((resolve) => {
              endListening = resolve;
            }),
          );
          return Promise.resolve(new Response('{}', { status: 200 }));
        });
      const controller = new AbortController();

      const window = await startWindow?.(adapter, 1_000, controller.signal);

      expect(listen).toHaveBeenCalledTimes(1);
      const [, durationMs, signal, webhookUrl] = listen.mock.calls[0] ?? [];
      expect(durationMs).toBe(1_000);
      expect(signal).toBe(controller.signal);
      expect(webhookUrl).toBeUndefined();

      let ended = false;
      void window?.ended.then(() => {
        ended = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(ended).toBe(false);

      endListening();
      await window?.ended;
      expect(ended).toBe(true);
    });
  });
});
