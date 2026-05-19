import { ConfigSource } from '@growi/core/dist/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — declared before imports so vi.mock() hoisting applies.
// ---------------------------------------------------------------------------

vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: vi.fn(),
  },
}));

// Import after mocks are set up.
import { configManager } from '~/server/service/config-manager';

import { vaultSettingsService } from './vault-settings-service';

describe('vaultSettingsService.getSettings()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('reads enabled from configManager without ConfigSource.env', async () => {
    vi.mocked(configManager.getConfig).mockImplementation((key, source) => {
      if (key === 'app:vaultEnabled') return true;
      return undefined;
    });

    const settings = await vaultSettingsService.getSettings();

    expect(settings.enabled).toBe(true);
    // enabled does NOT pass ConfigSource.env
    expect(configManager.getConfig).toHaveBeenCalledWith('app:vaultEnabled');
  });

  it('reads managerEndpoint via configManager with ConfigSource.env', async () => {
    const expectedEndpoint = 'http://vault-manager:3100';
    vi.mocked(configManager.getConfig).mockImplementation((key, source) => {
      if (key === 'app:vaultManagerEndpoint' && source === ConfigSource.env) {
        return expectedEndpoint;
      }
      return undefined;
    });

    const settings = await vaultSettingsService.getSettings();

    expect(configManager.getConfig).toHaveBeenCalledWith(
      'app:vaultManagerEndpoint',
      ConfigSource.env,
    );
    expect(settings.managerEndpoint).toBe(expectedEndpoint);
  });

  it('reads managerInternalSecret via configManager with ConfigSource.env', async () => {
    const expectedSecret = 'super-secret-value';
    vi.mocked(configManager.getConfig).mockImplementation((key, source) => {
      if (
        key === 'app:vaultManagerInternalSecret' &&
        source === ConfigSource.env
      ) {
        return expectedSecret;
      }
      return undefined;
    });

    const settings = await vaultSettingsService.getSettings();

    expect(configManager.getConfig).toHaveBeenCalledWith(
      'app:vaultManagerInternalSecret',
      ConfigSource.env,
    );
    expect(settings.managerInternalSecret).toBe(expectedSecret);
  });

  it('returns empty string for managerEndpoint when configManager returns undefined', async () => {
    vi.mocked(configManager.getConfig).mockReturnValue(undefined);

    const settings = await vaultSettingsService.getSettings();

    expect(settings.managerEndpoint).toBe('');
  });

  it('returns empty string for managerInternalSecret when configManager returns undefined', async () => {
    vi.mocked(configManager.getConfig).mockReturnValue(undefined);

    const settings = await vaultSettingsService.getSettings();

    expect(settings.managerInternalSecret).toBe('');
  });

  it('does NOT read process.env directly for managerEndpoint or managerInternalSecret', async () => {
    // Set process.env values to ensure they are NOT used (configManager is the source)
    process.env.VAULT_MANAGER_ENDPOINT = 'http://should-not-be-read:9999';
    process.env.VAULT_MANAGER_INTERNAL_SECRET = 'should-not-be-read-secret';

    const configEndpoint = 'http://config-manager-endpoint:3100';
    vi.mocked(configManager.getConfig).mockImplementation((key, source) => {
      if (key === 'app:vaultManagerEndpoint' && source === ConfigSource.env) {
        return configEndpoint;
      }
      return undefined;
    });

    const settings = await vaultSettingsService.getSettings();

    // Should return configManager value, not process.env value
    expect(settings.managerEndpoint).toBe(configEndpoint);
    expect(settings.managerEndpoint).not.toBe('http://should-not-be-read:9999');

    // Clean up
    delete process.env.VAULT_MANAGER_ENDPOINT;
    delete process.env.VAULT_MANAGER_INTERNAL_SECRET;
  });
});
