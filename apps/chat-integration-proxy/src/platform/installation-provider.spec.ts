// Task 3.2: this wrapper adds no logic beyond delegation, so what needs
// pinning down is that it delegates with the exact arguments and passes the
// result straight through -- including the `null`-on-miss case -- and that
// `list()` genuinely supports one proxy serving several workspaces for the
// same platform (「1 台の proxy に複数の workspace がぶら下がる」).
import { mock } from 'vitest-mock-extended';

import type { InstallationRepository } from '../db/index.js';
import type { InstallationCredentials } from '../types/index.js';
import { createInstallationProvider } from './installation-provider.js';

describe('createInstallationProvider', () => {
  describe('resolve', () => {
    it('resolves workspace credentials by delegating to the repository with the exact arguments', async () => {
      const credentials: InstallationCredentials = {
        slack: { botToken: 'xoxb-test' },
      };
      const repository = mock<InstallationRepository>();
      repository.resolveCredentials.mockResolvedValue(credentials);

      const provider = createInstallationProvider(repository);

      await expect(provider.resolve('slack', 'workspace-1')).resolves.toBe(
        credentials,
      );
      expect(repository.resolveCredentials).toHaveBeenCalledWith(
        'slack',
        'workspace-1',
      );
    });

    it('reports no installation as null rather than throwing or substituting a default', async () => {
      const repository = mock<InstallationRepository>();
      repository.resolveCredentials.mockResolvedValue(null);

      const provider = createInstallationProvider(repository);

      await expect(
        provider.resolve('mattermost', 'unknown-workspace'),
      ).resolves.toBeNull();
    });
  });

  describe('list', () => {
    it('lists the installations a platform connection serves, across multiple workspaces on one proxy', async () => {
      // The concrete acceptance criterion this task exists for: a single
      // proxy resolves credentials correctly for more than one workspace on
      // the same platform, not just a single hard-coded one.
      const entries = [
        { installationId: 'inst-1', workspaceId: 'workspace-1' },
        { installationId: 'inst-2', workspaceId: 'workspace-2' },
      ];
      const repository = mock<InstallationRepository>();
      repository.listByPlatform.mockResolvedValue(entries);

      const provider = createInstallationProvider(repository);

      await expect(provider.list('slack')).resolves.toEqual(entries);
      expect(repository.listByPlatform).toHaveBeenCalledWith('slack');
    });

    it('returns an empty list rather than throwing when the platform has no installations', async () => {
      const repository = mock<InstallationRepository>();
      repository.listByPlatform.mockResolvedValue([]);

      const provider = createInstallationProvider(repository);

      await expect(provider.list('discord')).resolves.toEqual([]);
    });
  });
});
