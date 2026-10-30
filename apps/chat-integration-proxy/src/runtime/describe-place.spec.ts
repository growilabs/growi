import { mock } from 'vitest-mock-extended';

import { testSdkChannel } from '../capabilities/test-channels.js';
import type {
  InstallationChannelRecord,
  InstallationChannelRepository,
  InstallationRepository,
} from '../db/index.js';
import { describePlace } from './describe-place.js';

const channel = testSdkChannel('slack');

describe('describePlace', () => {
  it('returns the channel name saved in the inventory', async () => {
    const installations =
      mock<Pick<InstallationRepository, 'listByPlatform'>>();
    installations.listByPlatform.mockResolvedValue([
      { installationId: 'i-1', workspaceId: 'T1' },
    ]);
    const channels = mock<Pick<InstallationChannelRepository, 'find'>>();
    channels.find.mockResolvedValue(
      mock<InstallationChannelRecord>({ channelName: 'saved-name' }),
    );

    await expect(
      describePlace({ installations, channels }, channel),
    ).resolves.toBe('saved-name');
  });

  it('returns null for a channel that is in no installation inventory', async () => {
    const installations =
      mock<Pick<InstallationRepository, 'listByPlatform'>>();
    installations.listByPlatform.mockResolvedValue([
      { installationId: 'i-1', workspaceId: 'T1' },
    ]);
    const channels = mock<Pick<InstallationChannelRepository, 'find'>>();
    channels.find.mockResolvedValue(null);

    await expect(
      describePlace({ installations, channels }, channel),
    ).resolves.toBeNull();
  });

  it('returns null when the platform has no installation', async () => {
    const installations =
      mock<Pick<InstallationRepository, 'listByPlatform'>>();
    installations.listByPlatform.mockResolvedValue([]);
    const channels = mock<Pick<InstallationChannelRepository, 'find'>>();

    await expect(
      describePlace({ installations, channels }, channel),
    ).resolves.toBeNull();
  });
});
