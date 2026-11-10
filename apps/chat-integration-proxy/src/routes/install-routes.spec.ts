import type { PlatformName } from '@growi/chat';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type {
  InstallationStore,
  OAuthExchangeTable,
} from '../platform/index.js';
import type { PlatformAppConfig } from '../types/index.js';
import {
  type InstallRoutesDeps,
  installCallbackPath,
  registerInstallRoutes,
} from './install-routes.js';

const APP_CONFIG: PlatformAppConfig = {
  slack: {
    signingSecret: 'signing-secret',
    clientId: 'slack-client-id',
    clientSecret: 'slack-client-secret',
    appToken: 'xapp-token',
  },
  discord: {
    applicationId: 'discord-application-id',
    publicKey: 'discord-public-key',
    clientSecret: 'discord-client-secret',
    botToken: 'discord-bot-token',
  },
  stateConnectionString: 'postgres://unused',
};

/** An exchange table that answers one installation without any network call. */
const tableAnswering = (
  platform: PlatformName,
  installation: {
    workspaceId: string;
    workspaceName: string;
    credentials: Record<string, unknown>;
  },
): OAuthExchangeTable => ({
  [platform]: {
    exchange: async () => ({
      ok: true as const,
      installation: { platform, ...installation },
    }),
  },
});

const tableRefusing = (platform: PlatformName): OAuthExchangeTable => ({
  [platform]: {
    exchange: async () => ({
      ok: false as const,
      reason: 'exchange-failed' as const,
      detail: 'slack said invalid_code',
    }),
  },
});

interface Harness {
  readonly app: Hono;
  readonly save: ReturnType<typeof vi.fn>;
  readonly onInstallFailed: ReturnType<typeof vi.fn>;
}

const harness = (overrides: Partial<InstallRoutesDeps> = {}): Harness => {
  const save = vi.fn(async () => 'installation-1');
  const onInstallFailed = vi.fn();
  const app = new Hono();
  registerInstallRoutes(app, {
    appConfig: APP_CONFIG,
    installations: mock<InstallationStore>({ save }),
    onInstallFailed,
    ...overrides,
  });
  return { app, save, onInstallFailed };
};

describe('installCallbackPath', () => {
  it('is the path design.md declares for the OAuth callback', () => {
    expect(installCallbackPath('slack')).toBe('/install/slack/callback');
    expect(installCallbackPath('discord')).toBe('/install/discord/callback');
  });
});

describe('the OAuth callback', () => {
  it.each<PlatformName>([
    'slack',
    'discord',
  ])('saves the %s installation the exchange answered', async (platform) => {
    const { app, save } = harness({
      exchanges: tableAnswering(platform, {
        workspaceId: 'W1',
        workspaceName: 'Acme',
        credentials: { [platform]: {} },
      }),
    });

    const response = await app.request(
      `${installCallbackPath(platform)}?code=the-code`,
    );

    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledWith(platform, 'W1', 'Acme', {
      [platform]: {},
    });
  });

  it('registers a route for every service the exchange table names, and none other', async () => {
    const { app } = harness({
      exchanges: tableAnswering('slack', {
        workspaceId: 'W1',
        workspaceName: 'Acme',
        credentials: {},
      }),
    });

    expect(
      (await app.request(`${installCallbackPath('slack')}?code=c`)).status,
    ).toBe(200);
    // Teams installs no workspace through an OAuth callback, so no route may
    // exist for it -- a 404 rather than an endpoint that answers something.
    expect(
      (await app.request(`${installCallbackPath('teams')}?code=c`)).status,
    ).toBe(404);
  });

  it('answers 400 and saves nothing when the exchange refuses', async () => {
    const { app, save } = harness({ exchanges: tableRefusing('slack') });

    const response = await app.request(
      `${installCallbackPath('slack')}?code=bad`,
    );

    expect(response.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it("never repeats the chat service's own error text back to the browser", async () => {
    const { app } = harness({ exchanges: tableRefusing('slack') });

    const body = await (
      await app.request(`${installCallbackPath('slack')}?code=bad`)
    ).text();

    expect(body).not.toContain('invalid_code');
  });

  it('reports the refused install to the operator instead of dropping it', async () => {
    const { app, onInstallFailed } = harness({
      exchanges: tableRefusing('slack'),
    });

    await app.request(`${installCallbackPath('slack')}?code=bad`);

    expect(onInstallFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'slack',
        reason: 'exchange-failed',
        detail: 'slack said invalid_code',
      }),
    );
  });

  it('hands the exchange the code the chat service sent back', async () => {
    const exchange = vi.fn(async () => ({
      ok: true as const,
      installation: {
        platform: 'slack' as PlatformName,
        workspaceId: 'W1',
        workspaceName: 'Acme',
        credentials: {},
      },
    }));
    const { app } = harness({ exchanges: { slack: { exchange } } });

    await app.request(`${installCallbackPath('slack')}?code=the-code`);

    expect(exchange).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'the-code' }),
    );
  });
});
