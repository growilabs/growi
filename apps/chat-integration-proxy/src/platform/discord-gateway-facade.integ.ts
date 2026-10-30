// Through the real facade and its connection manager: holding `app:discord`
// is what starts the Discord Gateway, and giving it back (shutdown) is what
// stops it. Only `startGatewayListener` is replaced, so no socket is opened.
import { DiscordAdapter } from '@chat-adapter/discord';
import { mock } from 'vitest-mock-extended';

import type { PlatformAppConfig, PlatformEventSink } from '../types/index.js';
import { createPlatformFacade, type PlatformFacade } from './index.js';
import type { InstallationProvider } from './installation-provider.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy';
const STATE_CONNECTION_STRING =
  process.env.CHAT_SDK_DATABASE_URL ??
  `${DATABASE_URL}?options=-c%20search_path%3Dchat_sdk`;

const WITH_DISCORD: PlatformAppConfig = {
  discord: {
    applicationId: '100000000000000001',
    publicKey: 'a'.repeat(64),
    clientSecret: 'discord-client-secret',
    botToken: 'discord-bot-token',
  },
  stateConnectionString: STATE_CONNECTION_STRING,
};
const WITHOUT_DISCORD: PlatformAppConfig = {
  stateConnectionString: STATE_CONNECTION_STRING,
};

const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

describe('the Discord Gateway through the facade', () => {
  let facade: PlatformFacade | null = null;
  const signals: AbortSignal[] = [];

  const listen = vi
    .spyOn(DiscordAdapter.prototype, 'startGatewayListener')
    .mockImplementation((options, _durationMs, abortSignal) => {
      if (abortSignal != null) signals.push(abortSignal);
      options.waitUntil?.(
        new Promise<void>((resolve) => {
          abortSignal?.addEventListener('abort', () => resolve(), {
            once: true,
          });
        }),
      );
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

  beforeEach(() => {
    signals.length = 0;
    listen.mockClear();
  });

  afterEach(async () => {
    await facade?.shutdown();
    facade = null;
  });

  const open = async (config: PlatformAppConfig): Promise<PlatformFacade> => {
    const opened = await createPlatformFacade(
      config,
      mock<InstallationProvider>({ list: async () => [] }),
      mock<PlatformEventSink>(),
    );
    facade = opened;
    await opened.connections().start();
    return opened;
  };

  it('starts listening once the Discord connection is held, handling events in-process', async () => {
    const opened = await open(WITH_DISCORD);

    expect(listen).toHaveBeenCalledTimes(1);
    const [options, durationMs, signal, webhookUrl] =
      listen.mock.calls[0] ?? [];
    expect(options?.waitUntil).toEqual(expect.any(Function));
    expect(durationMs).toBeLessThanOrEqual(MAX_TIMER_DELAY_MS);
    expect(signal?.aborted).toBe(false);
    expect(webhookUrl).toBeUndefined();

    const rows = await opened.connections().status();
    expect(rows.find((row) => row.platform === 'discord')?.state).toBe(
      'connected',
    );
  });

  it('stops listening on shutdown', async () => {
    const opened = await open(WITH_DISCORD);

    await opened.shutdown();
    facade = null;

    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it('never listens when Discord is not configured', async () => {
    await open(WITHOUT_DISCORD);

    expect(listen).not.toHaveBeenCalled();
  });
});
