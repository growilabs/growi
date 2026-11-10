import type { PlatformName } from '@growi/chat';
import { describe, expect, it, vi } from 'vitest';

import type { PlatformAppConfig } from '../types/index.js';
import { completeOAuthCallback, OAUTH_EXCHANGES } from './oauth-callback.js';

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

const CALLBACK_URL = (platform: PlatformName, query = 'code=the-code') =>
  `https://proxy.example.com/install/${platform}/callback?${query}`;

/** A `fetch` double that answers every call with one JSON body. */
const respondingWith = (
  body: unknown,
  init: ResponseInit = { status: 200 },
): typeof fetch =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
        ...init,
      }),
  ) as unknown as typeof fetch;

/** Reads the form fields one recorded `fetch` call posted. */
const postedForm = (fetchDouble: typeof fetch): URLSearchParams => {
  const mocked = vi.mocked(fetchDouble);
  const call = mocked.mock.calls[0];
  if (call == null) throw new Error('fetch was never called');
  const body = (call[1] as RequestInit | undefined)?.body;
  if (typeof body !== 'string') {
    throw new Error('the exchange did not post a form-encoded body');
  }
  return new URLSearchParams(body);
};

describe('OAUTH_EXCHANGES', () => {
  it('covers Slack and Discord, and no service that installs another way', () => {
    // Mattermost is installed from a config file at startup and Teams carries
    // no per-workspace installation of its own -- design.md's
    // 「呼ぶ入り口は 2 つ」 table.
    expect(Object.keys(OAUTH_EXCHANGES).sort()).toEqual(['discord', 'slack']);
  });
});

describe('completeOAuthCallback: Slack', () => {
  it('exchanges the code and answers the workspace and its bot token', async () => {
    const fetchDouble = respondingWith({
      ok: true,
      access_token: 'xoxb-workspace-token',
      team: { id: 'T123', name: 'Acme' },
    });

    const result = await completeOAuthCallback(
      'slack',
      new Request(CALLBACK_URL('slack')),
      { appConfig: APP_CONFIG, fetch: fetchDouble },
      OAUTH_EXCHANGES,
    );

    expect(result).toEqual({
      ok: true,
      installation: {
        platform: 'slack',
        workspaceId: 'T123',
        workspaceName: 'Acme',
        credentials: { slack: { botToken: 'xoxb-workspace-token' } },
      },
    });
  });

  it('sends the code, the app credentials and the callback URL as the redirect URI', async () => {
    const fetchDouble = respondingWith({
      ok: true,
      access_token: 'xoxb-workspace-token',
      team: { id: 'T123', name: 'Acme' },
    });

    await completeOAuthCallback(
      'slack',
      new Request(CALLBACK_URL('slack', 'code=the-code&state=xyz')),
      { appConfig: APP_CONFIG, fetch: fetchDouble },
      OAUTH_EXCHANGES,
    );

    const form = postedForm(fetchDouble);
    expect(form.get('code')).toBe('the-code');
    expect(form.get('client_id')).toBe('slack-client-id');
    expect(form.get('client_secret')).toBe('slack-client-secret');
    // The query string is dropped: the redirect URI Slack was given at
    // authorize time is the path alone.
    expect(form.get('redirect_uri')).toBe(
      'https://proxy.example.com/install/slack/callback',
    );
  });

  it('prefers an explicitly configured redirect URI over the request URL', async () => {
    const fetchDouble = respondingWith({
      ok: true,
      access_token: 'xoxb-workspace-token',
      team: { id: 'T123', name: 'Acme' },
    });

    await completeOAuthCallback(
      'slack',
      new Request('http://10.0.0.4:8080/install/slack/callback?code=the-code'),
      {
        appConfig: APP_CONFIG,
        fetch: fetchDouble,
        redirectUri: 'https://proxy.example.com/install/slack/callback',
      },
      OAUTH_EXCHANGES,
    );

    expect(postedForm(fetchDouble).get('redirect_uri')).toBe(
      'https://proxy.example.com/install/slack/callback',
    );
  });

  it('keys an org-wide install by the enterprise, the way Slack itself stores it', async () => {
    const fetchDouble = respondingWith({
      ok: true,
      access_token: 'xoxb-org-token',
      is_enterprise_install: true,
      team: null,
      enterprise: { id: 'E999', name: 'Acme Grid' },
    });

    const result = await completeOAuthCallback(
      'slack',
      new Request(CALLBACK_URL('slack')),
      { appConfig: APP_CONFIG, fetch: fetchDouble },
      OAUTH_EXCHANGES,
    );

    expect(result).toMatchObject({
      ok: true,
      installation: { workspaceId: 'E999', workspaceName: 'Acme Grid' },
    });
  });

  it('refuses a callback Slack answered with an error', async () => {
    const result = await completeOAuthCallback(
      'slack',
      new Request(CALLBACK_URL('slack')),
      {
        appConfig: APP_CONFIG,
        fetch: respondingWith({ ok: false, error: 'invalid_code' }),
      },
      OAUTH_EXCHANGES,
    );

    expect(result).toMatchObject({ ok: false, reason: 'exchange-failed' });
  });

  it('refuses a callback that carries no code, without calling out', async () => {
    const fetchDouble = respondingWith({ ok: true });

    const result = await completeOAuthCallback(
      'slack',
      new Request(CALLBACK_URL('slack', 'error=access_denied')),
      { appConfig: APP_CONFIG, fetch: fetchDouble },
      OAUTH_EXCHANGES,
    );

    expect(result).toMatchObject({ ok: false, reason: 'invalid-callback' });
    expect(fetchDouble).not.toHaveBeenCalled();
  });

  it('refuses when this deployment configures no Slack app at all', async () => {
    const result = await completeOAuthCallback(
      'slack',
      new Request(CALLBACK_URL('slack')),
      {
        appConfig: { stateConnectionString: 'postgres://unused' },
        fetch: respondingWith({ ok: true }),
      },
      OAUTH_EXCHANGES,
    );

    expect(result).toMatchObject({ ok: false, reason: 'not-configured' });
  });

  it('never carries the app secret out in the failure detail', async () => {
    const result = await completeOAuthCallback(
      'slack',
      new Request(CALLBACK_URL('slack')),
      {
        appConfig: APP_CONFIG,
        fetch: respondingWith({ ok: false, error: 'invalid_code' }),
      },
      OAUTH_EXCHANGES,
    );

    expect(JSON.stringify(result)).not.toContain('slack-client-secret');
  });
});

describe('completeOAuthCallback: Discord', () => {
  it('exchanges the code and answers the guild, with no per-workspace credential', async () => {
    // Discord's bot token is app-level (`PlatformAppConfig.discord.botToken`),
    // so `InstallationCredentials.discord` is `Record<string, never>` -- the
    // user access token the exchange also returns is deliberately dropped.
    const fetchDouble = respondingWith({
      access_token: 'a-user-token-nothing-reads',
      guild: { id: 'G777', name: 'Acme Server' },
    });

    const result = await completeOAuthCallback(
      'discord',
      new Request(CALLBACK_URL('discord')),
      { appConfig: APP_CONFIG, fetch: fetchDouble },
      OAUTH_EXCHANGES,
    );

    expect(result).toEqual({
      ok: true,
      installation: {
        platform: 'discord',
        workspaceId: 'G777',
        workspaceName: 'Acme Server',
        credentials: { discord: {} },
      },
    });
    expect(JSON.stringify(result)).not.toContain('a-user-token-nothing-reads');
  });

  it("sends the application id as Discord's OAuth client id", async () => {
    const fetchDouble = respondingWith({
      guild: { id: 'G777', name: 'Acme Server' },
    });

    await completeOAuthCallback(
      'discord',
      new Request(CALLBACK_URL('discord')),
      { appConfig: APP_CONFIG, fetch: fetchDouble },
      OAUTH_EXCHANGES,
    );

    const form = postedForm(fetchDouble);
    expect(form.get('client_id')).toBe('discord-application-id');
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('redirect_uri')).toBe(
      'https://proxy.example.com/install/discord/callback',
    );
  });

  it('refuses an authorization that named no server, rather than inventing one', async () => {
    const result = await completeOAuthCallback(
      'discord',
      new Request(CALLBACK_URL('discord')),
      {
        appConfig: APP_CONFIG,
        fetch: respondingWith({ access_token: 'user-token-only' }),
      },
      OAUTH_EXCHANGES,
    );

    expect(result).toMatchObject({ ok: false, reason: 'invalid-callback' });
  });

  it('refuses when Discord answers a non-2xx status', async () => {
    const result = await completeOAuthCallback(
      'discord',
      new Request(CALLBACK_URL('discord')),
      {
        appConfig: APP_CONFIG,
        fetch: respondingWith({ error: 'invalid_grant' }, { status: 400 }),
      },
      OAUTH_EXCHANGES,
    );

    expect(result).toMatchObject({ ok: false, reason: 'exchange-failed' });
  });
});

describe('completeOAuthCallback: services with no OAuth callback', () => {
  it.each<PlatformName>([
    'teams',
    'mattermost',
  ])('refuses %s rather than pretending it installs this way', async (platform) => {
    const result = await completeOAuthCallback(
      platform,
      new Request(CALLBACK_URL(platform)),
      { appConfig: APP_CONFIG, fetch: respondingWith({}) },
      OAUTH_EXCHANGES,
    );

    expect(result).toMatchObject({
      ok: false,
      reason: 'unsupported-platform',
    });
  });
});

describe('completeOAuthCallback: the exchange table is an input', () => {
  it('uses the table it is given, not the declared one', async () => {
    const exchange = vi.fn(async () => ({
      ok: true as const,
      installation: {
        platform: 'slack' as PlatformName,
        workspaceId: 'from-the-supplied-table',
        workspaceName: 'Supplied',
        credentials: {},
      },
    }));

    const result = await completeOAuthCallback(
      'slack',
      new Request(CALLBACK_URL('slack')),
      { appConfig: APP_CONFIG, fetch: respondingWith({}) },
      { slack: { exchange } },
    );

    expect(result).toMatchObject({
      ok: true,
      installation: { workspaceId: 'from-the-supplied-table' },
    });
    expect(exchange).toHaveBeenCalledTimes(1);
  });
});
