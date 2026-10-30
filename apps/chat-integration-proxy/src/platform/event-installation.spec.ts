// Which installation an incoming event belongs to, answered from what the
// event and its adapter say -- never from the saved channel inventory, which
// does not list DMs or channels the bot reached without an invitation.
import type { PlatformName } from '@growi/chat';
import type { Adapter } from 'chat';
import { mock } from 'vitest-mock-extended';

import { ADAPTER_FACTORIES, type AdapterFactory } from './adapter-set.js';
import {
  identifyEventInstallation,
  lookUpEventInstallation,
} from './event-installation.js';
import type { InstallationProvider } from './installation-provider.js';

const HELD = [
  { installationId: 'inst-1', workspaceId: 'T1' },
  { installationId: 'inst-2', workspaceId: 'T2' },
];

const installationsHolding = (): InstallationProvider => {
  const installations = mock<InstallationProvider>();
  installations.list.mockImplementation(async (platform) =>
    platform === 'slack' ? HELD : [],
  );
  return installations;
};

/** The declared table, with Slack's event-workspace reader replaced. */
const factoriesReading = (
  workspaceOfEvent: (
    adapter: Adapter,
    channelId: string,
  ) => Promise<string | null>,
): Readonly<Record<PlatformName, AdapterFactory>> => ({
  ...ADAPTER_FACTORIES,
  slack: { credentialSource: 'app', create: () => null, workspaceOfEvent },
});

describe('lookUpEventInstallation', () => {
  it('names the installation held for the workspace the event came from', async () => {
    const found = await lookUpEventInstallation(
      {
        platform: 'slack',
        factories: factoriesReading(async () => 'T2'),
        installations: installationsHolding(),
      },
      mock<Adapter>(),
      'slack:D0DM',
    );

    expect(found).toEqual({ kind: 'identified', installationId: 'inst-2' });
  });

  it('names the installation an adapter was opened for, without asking anything', async () => {
    const installations = installationsHolding();

    const found = await lookUpEventInstallation(
      {
        platform: 'mattermost',
        installationId: 'inst-mm',
        factories: ADAPTER_FACTORIES,
        installations,
      },
      mock<Adapter>(),
      'channel-1',
    );

    expect(found).toEqual({ kind: 'identified', installationId: 'inst-mm' });
    expect(installations.list).not.toHaveBeenCalled();
  });

  it('says the place belongs to no workspace when the service says so (a Discord DM)', async () => {
    const found = await lookUpEventInstallation(
      {
        platform: 'slack',
        factories: factoriesReading(async () => null),
        installations: installationsHolding(),
      },
      mock<Adapter>(),
      'slack:D0DM',
    );

    expect(found).toEqual({ kind: 'no-workspace' });
  });

  it('leaves the event unidentified, naming why, when no installation is held for its workspace', async () => {
    const found = await lookUpEventInstallation(
      {
        platform: 'slack',
        factories: factoriesReading(async () => 'T-unknown'),
        installations: installationsHolding(),
      },
      mock<Adapter>(),
      'slack:C1',
    );

    expect(found.kind).toBe('unidentified');
    expect(found.kind === 'unidentified' && found.reason).toContain(
      'T-unknown',
    );
  });

  it('leaves the event unidentified for a service that declares no way to tell the workspace', async () => {
    const found = await lookUpEventInstallation(
      {
        platform: 'teams',
        factories: ADAPTER_FACTORIES,
        installations: installationsHolding(),
      },
      mock<Adapter>(),
      'teams:abc:def',
    );

    expect(found.kind).toBe('unidentified');
    expect(found.kind === 'unidentified' && found.reason).toContain('teams');
  });

  it('passes on a failure to read the workspace rather than guessing', async () => {
    const cause = new Error('invalid_auth');

    await expect(
      lookUpEventInstallation(
        {
          platform: 'slack',
          factories: factoriesReading(() => Promise.reject(cause)),
          installations: installationsHolding(),
        },
        mock<Adapter>(),
        'slack:C1',
      ),
    ).rejects.toBe(cause);
  });
});

describe('identifyEventInstallation', () => {
  it('hands back what the event named', async () => {
    const reported: unknown[] = [];

    const found = await identifyEventInstallation(
      {
        platform: 'slack',
        factories: factoriesReading(async () => 'T1'),
        installations: installationsHolding(),
      },
      (_message, error) => reported.push(error),
    )(mock<Adapter>(), 'slack:C1');

    expect(found).toEqual({ kind: 'identified', installationId: 'inst-1' });
    expect(reported).toEqual([]);
  });

  it('leaves an unplaced event to the inventory without reporting it', async () => {
    const reported: unknown[] = [];

    const found = await identifyEventInstallation(
      {
        platform: 'teams',
        factories: ADAPTER_FACTORIES,
        installations: installationsHolding(),
      },
      (_message, error) => reported.push(error),
    )(mock<Adapter>(), 'teams:abc:def');

    expect(found).toBeUndefined();
    expect(reported).toEqual([]);
  });

  it('reports a failure to ask, and still answers, so the event is handled', async () => {
    const cause = new Error('invalid_auth');
    const reported: Array<{ message: string; error: unknown }> = [];

    const found = await identifyEventInstallation(
      {
        platform: 'slack',
        factories: factoriesReading(() => Promise.reject(cause)),
        installations: installationsHolding(),
      },
      (message, error) => reported.push({ message, error }),
    )(mock<Adapter>(), 'slack:C1');

    expect(found).toBeUndefined();
    expect(reported).toHaveLength(1);
    expect(reported[0]?.error).toBe(cause);
    expect(reported[0]?.message).toContain('slack');
  });
});
