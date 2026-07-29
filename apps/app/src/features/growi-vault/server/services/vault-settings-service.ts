import { ConfigSource } from '@growi/core/dist/interfaces';

import { configManager } from '~/server/service/config-manager';

/**
 * Resolved Vault settings consumed by gateway components.
 */
export interface VaultSettings {
  /** Whether the GROWI Vault feature is enabled. Read from VAULT_ENABLED env var only (no DB fallback). */
  readonly enabled: boolean;
  /** Internal URL of growi-vault-manager. Read from VAULT_MANAGER_ENDPOINT env var only. */
  readonly managerEndpoint: string;
  /** Shared secret used to authenticate requests to growi-vault-manager. Read from VAULT_MANAGER_INTERNAL_SECRET env var only. */
  readonly managerInternalSecret: string;
}

/**
 * Service that resolves GROWI Vault configuration from config sources.
 *
 * All three settings are resolved via ConfigManager with ConfigSource.env to
 * guarantee env-only resolution with no DB fallback. Runtime mutation of
 * `app:vaultEnabled` via the admin UI is not supported — to disable the
 * feature in an emergency, use the admin UI "Wipe Vault" kill switch instead.
 */
export interface VaultSettingsService {
  getSettings(): Promise<VaultSettings>;
}

class VaultSettingsServiceImpl implements VaultSettingsService {
  async getSettings(): Promise<VaultSettings> {
    // All three settings are env-only. Pass ConfigSource.env to prevent DB
    // fallback — DB writes to `app:vaultEnabled` must NOT influence the
    // resolved value.
    const enabled =
      configManager.getConfig('app:vaultEnabled', ConfigSource.env) ?? false;
    const managerEndpoint =
      configManager.getConfig('app:vaultManagerEndpoint', ConfigSource.env) ??
      '';
    const managerInternalSecret =
      configManager.getConfig(
        'app:vaultManagerInternalSecret',
        ConfigSource.env,
      ) ?? '';

    return {
      enabled,
      managerEndpoint,
      managerInternalSecret,
    };
  }
}

/** Singleton instance of VaultSettingsService. */
export const vaultSettingsService: VaultSettingsService =
  new VaultSettingsServiceImpl();
