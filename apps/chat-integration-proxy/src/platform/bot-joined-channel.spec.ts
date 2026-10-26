// What happens once the bot itself has been added to a channel: the channel
// inventory of the installation it was added in is taken again, so a command
// typed there seconds later resolves instead of waiting for the periodic
// refresh. `event-handlers.spec.ts` covers telling the bot's own join from a
// person's; this file covers which installation is refreshed, and that no
// failure on the way escapes the handler.
import type { PlatformName } from '@growi/chat';
import type { Adapter } from 'chat';
import { mock } from 'vitest-mock-extended';

import { ADAPTER_FACTORIES, type AdapterFactory } from './adapter-set.js';
import { refreshOnBotJoin } from './bot-joined-channel.js';
import type { InstallationProvider } from './installation-provider.js';

const HELD = [
  { installationId: 'inst-1', workspaceId: 'T1' },
  { installationId: 'inst-2', workspaceId: 'T2' },
];

/** The declared table, with Slack's event-workspace reader replaced. */
const factoriesReading = (
  workspaceOfEvent: (adapter: Adapter) => Promise<string>,
): Readonly<Record<PlatformName, AdapterFactory>> => ({
  ...ADAPTER_FACTORIES,
  slack: { credentialSource: 'app', create: () => null, workspaceOfEvent },
});

const installationsHolding = (): InstallationProvider => {
  const installations = mock<InstallationProvider>();
  installations.list.mockImplementation(async (platform) =>
    platform === 'slack' ? HELD : [],
  );
  return installations;
};

interface Harness {
  readonly refreshed: string[];
  readonly reported: Array<{ message: string; error: unknown }>;
}

const harness = (
  refresh: (installationId: string) => Promise<void> = () => Promise.resolve(),
): Harness & {
  readonly refreshChannels: (installationId: string) => Promise<void>;
  readonly reportOperationalFailure: (message: string, error?: unknown) => void;
} => {
  const refreshed: string[] = [];
  const reported: Array<{ message: string; error: unknown }> = [];
  return {
    refreshed,
    reported,
    refreshChannels: (installationId) => {
      refreshed.push(installationId);
      return refresh(installationId);
    },
    reportOperationalFailure: (message, error) => {
      reported.push({ message, error });
    },
  };
};

describe('an adapter serving many workspaces (app-credentialed)', () => {
  it('refreshes exactly the inventory of the installation whose workspace the event came from', async () => {
    const h = harness();
    const adapter = mock<Adapter>({ name: 'slack' });
    const workspaceOfEvent = vi.fn(async () => 'T2');

    await refreshOnBotJoin({
      platform: 'slack',
      factories: factoriesReading(workspaceOfEvent),
      installations: installationsHolding(),
      refreshChannels: h.refreshChannels,
      reportOperationalFailure: h.reportOperationalFailure,
    })(adapter);

    expect(h.refreshed).toEqual(['inst-2']);
    expect(h.reported).toEqual([]);
    // The workspace is read from the adapter serving the event, which is the
    // only thing that knows whose bot token it is speaking with.
    expect(workspaceOfEvent).toHaveBeenCalledWith(adapter);
  });

  it('reports, and refreshes nothing, when the workspace cannot be read', async () => {
    const h = harness();
    const cause = new Error('invalid_auth');

    await expect(
      refreshOnBotJoin({
        platform: 'slack',
        factories: factoriesReading(() => Promise.reject(cause)),
        installations: installationsHolding(),
        refreshChannels: h.refreshChannels,
        reportOperationalFailure: h.reportOperationalFailure,
      })(mock<Adapter>()),
    ).resolves.toBeUndefined();

    expect(h.refreshed).toEqual([]);
    expect(h.reported).toHaveLength(1);
    expect(h.reported[0]?.error).toBe(cause);
    expect(h.reported[0]?.message).toContain('slack');
  });

  it('reports, and refreshes nothing, when no installation is held for that workspace', async () => {
    const h = harness();

    await refreshOnBotJoin({
      platform: 'slack',
      factories: factoriesReading(async () => 'T-unknown'),
      installations: installationsHolding(),
      refreshChannels: h.refreshChannels,
      reportOperationalFailure: h.reportOperationalFailure,
    })(mock<Adapter>());

    expect(h.refreshed).toEqual([]);
    expect(h.reported).toHaveLength(1);
    expect(h.reported[0]?.message).toContain('T-unknown');
  });

  it('reports, and refreshes nothing, for a service that declares no way to tell the workspace', async () => {
    // Discord declares no reader today. A join reaching it is not answered
    // with a guess; the periodic refresh still covers it.
    const h = harness();

    await refreshOnBotJoin({
      platform: 'discord',
      factories: ADAPTER_FACTORIES,
      installations: installationsHolding(),
      refreshChannels: h.refreshChannels,
      reportOperationalFailure: h.reportOperationalFailure,
    })(mock<Adapter>());

    expect(h.refreshed).toEqual([]);
    expect(h.reported).toHaveLength(1);
    expect(h.reported[0]?.message).toContain('discord');
  });
});

describe('an adapter opened for one installation alone', () => {
  it('refreshes that installation without asking the adapter anything', async () => {
    const h = harness();
    const installations = installationsHolding();

    await refreshOnBotJoin({
      platform: 'mattermost',
      installationId: 'inst-mm',
      factories: ADAPTER_FACTORIES,
      installations,
      refreshChannels: h.refreshChannels,
      reportOperationalFailure: h.reportOperationalFailure,
    })(mock<Adapter>());

    expect(h.refreshed).toEqual(['inst-mm']);
    expect(h.reported).toEqual([]);
  });
});

describe('a refresh that fails', () => {
  it('is reported with the installation it was for, and does not escape the handler', async () => {
    const cause = new Error('conversations.list: ratelimited');
    const h = harness(() => Promise.reject(cause));

    await expect(
      refreshOnBotJoin({
        platform: 'slack',
        factories: factoriesReading(async () => 'T1'),
        installations: installationsHolding(),
        refreshChannels: h.refreshChannels,
        reportOperationalFailure: h.reportOperationalFailure,
      })(mock<Adapter>()),
    ).resolves.toBeUndefined();

    expect(h.refreshed).toEqual(['inst-1']);
    expect(h.reported).toHaveLength(1);
    expect(h.reported[0]?.error).toBe(cause);
    expect(h.reported[0]?.message).toContain('inst-1');
  });
});
