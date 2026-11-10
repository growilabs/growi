// The Slack adapter receives every workspace's events on one app-level socket
// and asks this lookup for the bot that answers in the workspace an event came
// from. What a caller experiences is the answer: a bot token plus the bot's
// own user id (without which the adapter cannot recognize the bot's own
// posts), or `null` when no such bot can be named.
//
// Slack API calls are observed through an injected `fetch`, the same seam
// `channels.spec.ts` uses.
import type { PlatformName } from '@growi/chat';
import { mock } from 'vitest-mock-extended';

import type { InstallationCredentials } from '../types/index.js';
import type { InstallationProvider } from './installation-provider.js';
import { createSlackInstallationLookup } from './slack-installation-lookup.js';

const installationsOf = (
  rows: Readonly<Record<string, InstallationCredentials>>,
): InstallationProvider =>
  mock<InstallationProvider>({
    resolve: async (platform: PlatformName, workspaceId: string) =>
      platform === 'slack' ? (rows[workspaceId] ?? null) : null,
  });

/** A `fetch` answering `auth.test` per bot token, and counting the calls. */
const authTestStub = (
  answers: Readonly<Record<string, ReadonlyArray<unknown>>>,
) => {
  const calls: string[] = [];
  const served = new Map<string, number>();

  const answer = (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (!url.endsWith('/auth.test')) {
      throw new Error(`unexpected Slack call ${url}`);
    }
    const token = new Headers(init?.headers)
      .get('authorization')
      ?.replace('Bearer ', '');
    if (token == null) throw new Error('auth.test called without a token');
    calls.push(token);
    const index = served.get(token) ?? 0;
    served.set(token, index + 1);
    const body = answers[token]?.[index];
    if (body === undefined) throw new Error(`no auth.test answer for ${token}`);
    return new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    });
  };

  // A throw inside the executor becomes a rejection, as a failed fetch would.
  const stub: typeof fetch = (input, init) =>
    new Promise((resolve) => resolve(answer(input, init)));

  return { stub, calls };
};

describe('createSlackInstallationLookup', () => {
  it('answers a workspace install with its bot token and the bot user id Slack reports for it', async () => {
    const { stub } = authTestStub({
      'xoxb-team': [{ ok: true, user_id: 'UBOT1' }],
    });
    const lookup = createSlackInstallationLookup({
      installations: installationsOf({
        T0001: { slack: { botToken: 'xoxb-team' } },
      }),
      fetch: stub,
    });

    await expect(lookup.getInstallation('T0001', false)).resolves.toEqual({
      botToken: 'xoxb-team',
      botUserId: 'UBOT1',
    });
  });

  it('answers an Enterprise Grid org-wide install, which Slack addresses by the enterprise id it was saved under', async () => {
    const { stub } = authTestStub({
      'xoxb-org': [{ ok: true, user_id: 'UBOT2' }],
    });
    const lookup = createSlackInstallationLookup({
      installations: installationsOf({
        E0001: { slack: { botToken: 'xoxb-org' } },
      }),
      fetch: stub,
    });

    await expect(lookup.getInstallation('E0001', true)).resolves.toEqual({
      botToken: 'xoxb-org',
      botUserId: 'UBOT2',
    });
  });

  it('answers null for a workspace this proxy has no installation for', async () => {
    const { stub } = authTestStub({});
    const lookup = createSlackInstallationLookup({
      installations: installationsOf({}),
      fetch: stub,
    });

    await expect(lookup.getInstallation('T9999', false)).resolves.toBeNull();
  });

  it('answers null for an installation that carries no Slack credentials', async () => {
    const { stub } = authTestStub({});
    const lookup = createSlackInstallationLookup({
      installations: installationsOf({ T0001: {} }),
      fetch: stub,
    });

    await expect(lookup.getInstallation('T0001', false)).resolves.toBeNull();
  });

  it('answers null rather than a bot it cannot recognize itself as when Slack refuses auth.test, and asks again next time', async () => {
    // A token without a bot user id would let the bot react to its own posts
    // (e.g. preview a GROWI URL it just posted), so the event is left
    // unresolved instead.
    const { stub } = authTestStub({
      'xoxb-team': [
        { ok: false, error: 'invalid_auth' },
        { ok: true, user_id: 'UBOT1' },
      ],
    });
    const lookup = createSlackInstallationLookup({
      installations: installationsOf({
        T0001: { slack: { botToken: 'xoxb-team' } },
      }),
      fetch: stub,
    });

    await expect(lookup.getInstallation('T0001', false)).resolves.toBeNull();
    await expect(lookup.getInstallation('T0001', false)).resolves.toEqual({
      botToken: 'xoxb-team',
      botUserId: 'UBOT1',
    });
  });

  it('asks Slack for a bot user id once per bot token, not once per event', async () => {
    const { stub, calls } = authTestStub({
      'xoxb-team': [{ ok: true, user_id: 'UBOT1' }],
    });
    const lookup = createSlackInstallationLookup({
      installations: installationsOf({
        T0001: { slack: { botToken: 'xoxb-team' } },
      }),
      fetch: stub,
    });

    await Promise.all([
      lookup.getInstallation('T0001', false),
      lookup.getInstallation('T0001', false),
    ]);
    await lookup.getInstallation('T0001', false);

    expect(calls).toEqual(['xoxb-team']);
  });
});
