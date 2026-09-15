// Task 3.1: 「接続情報を受け取ってアダプタと state を組み立てる」.
//
// What is asserted here is the *observable contract* of the assembly step:
// which of the 4 services end up with an adapter for a given
// `PlatformAppConfig` / `InstallationCredentials`, and that the iteration is
// driven by the declared registry rather than by a chain of
// `if (platform === 'slack')`. The Chat SDK's own adapter behavior is not
// re-tested here -- it is third-party code.

import type { PlatformName } from '@growi/chat';
import type { Adapter } from 'chat';
import { mock } from 'vitest-mock-extended';

import type {
  InstallationCredentials,
  PlatformAppConfig,
} from '../types/index.js';
import type { AdapterFactory } from './adapter-set.js';
import {
  ADAPTER_FACTORIES,
  createAppAdapters,
  createChatState,
  createInstallationAdapter,
} from './adapter-set.js';

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
    const adapters = createAppAdapters(FULL_APP_CONFIG, ADAPTER_FACTORIES);

    expect(Object.keys(adapters).sort()).toEqual(
      ['discord', 'slack', 'teams'].sort(),
    );
  });

  it('builds no adapter for a service the app config does not configure', () => {
    // A deployment that only runs Slack simply has no `discord` / `teams`
    // block -- this is `PlatformAppConfig`'s optional fields doing the
    // filtering, not the capability table.
    const { discord, teams, ...slackOnly } = FULL_APP_CONFIG;

    const adapters = createAppAdapters(slackOnly, ADAPTER_FACTORIES);

    expect(Object.keys(adapters)).toEqual(['slack']);
  });

  it('never builds an app-wide adapter for mattermost, whose connection target is per installation', () => {
    const adapters = createAppAdapters(FULL_APP_CONFIG, ADAPTER_FACTORIES);

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

    const adapters = createAppAdapters(FULL_APP_CONFIG, factories);

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
