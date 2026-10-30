import { mock } from 'vitest-mock-extended';

import type { InstallationStore } from '../platform/index.js';
import type { MattermostInstallationConfig } from './config.js';
import { ensureMattermostInstallations } from './mattermost-installations.js';

const declared = (
  overrides: Partial<MattermostInstallationConfig> = {},
): MattermostInstallationConfig => ({
  workspaceId: 'team-1',
  workspaceName: 'Example Team',
  baseUrl: 'https://mattermost.internal',
  botToken: 'bot-token',
  ...overrides,
});

describe('ensureMattermostInstallations', () => {
  it('saves each declared installation with the credentials its connection is opened from', async () => {
    const store = mock<Pick<InstallationStore, 'save'>>();
    store.save.mockResolvedValue('installation-1');

    await ensureMattermostInstallations({
      store,
      declared: [declared()],
      onFailed: () => {},
    });

    expect(store.save).toHaveBeenCalledWith(
      'mattermost',
      'team-1',
      'Example Team',
      {
        mattermost: {
          baseUrl: 'https://mattermost.internal',
          botToken: 'bot-token',
        },
      },
    );
  });

  it('answers the ids of the installations it ensured, which is what a caller connects', async () => {
    const store = mock<Pick<InstallationStore, 'save'>>();
    store.save
      .mockResolvedValueOnce('installation-1')
      .mockResolvedValueOnce('installation-2');

    const ids = await ensureMattermostInstallations({
      store,
      declared: [declared(), declared({ workspaceId: 'team-2' })],
      onFailed: () => {},
    });

    expect(ids).toEqual(['installation-1', 'installation-2']);
  });

  it('touches storage not at all when nothing is declared', async () => {
    const store = mock<Pick<InstallationStore, 'save'>>();

    const ids = await ensureMattermostInstallations({
      store,
      declared: [],
      onFailed: () => {},
    });

    expect(store.save).not.toHaveBeenCalled();
    expect(ids).toEqual([]);
  });

  it('keeps going after one declaration fails, so a single unreachable server does not keep the others offline', async () => {
    const store = mock<Pick<InstallationStore, 'save'>>();
    store.save
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce('installation-2');
    const failures: unknown[] = [];

    const ids = await ensureMattermostInstallations({
      store,
      declared: [declared(), declared({ workspaceId: 'team-2' })],
      onFailed: (failure) => failures.push(failure),
    });

    expect(ids).toEqual(['installation-2']);
    expect(failures).toHaveLength(1);
  });

  it('reports a failure by the workspace it belongs to, never by repeating the bot token', async () => {
    const store = mock<Pick<InstallationStore, 'save'>>();
    store.save.mockRejectedValue(new Error('connection refused'));
    const failures: Array<{ workspaceId: string; error: unknown }> = [];

    await ensureMattermostInstallations({
      store,
      declared: [declared()],
      onFailed: (failure) => failures.push(failure),
    });

    expect(failures[0]?.workspaceId).toBe('team-1');
    expect(JSON.stringify(failures)).not.toContain('bot-token');
  });
});
