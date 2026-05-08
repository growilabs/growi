import { ConfigSource } from '@growi/core/dist/interfaces';

import { configManager } from '~/server/service/config-manager';

/**
 * Resolved Vault settings consumed by gateway components.
 */
export interface VaultSettings {
  /** Whether the GROWI Vault feature is enabled. Controlled via DB or VAULT_ENABLED env var. */
  readonly enabled: boolean;
  /** Internal URL of growi-vault-manager. Read from VAULT_MANAGER_ENDPOINT env var only. */
  readonly managerEndpoint: string;
  /** Shared secret used to authenticate requests to growi-vault-manager. Read from VAULT_MANAGER_INTERNAL_SECRET env var only. */
  readonly managerInternalSecret: string;
}

/**
 * Service that resolves GROWI Vault configuration from config sources.
 *
 * - `enabled`: resolved via ConfigManager (supports both DB and env var).
 * - `managerEndpoint`: resolved via ConfigManager with ConfigSource.env to prevent DB fallback.
 * - `managerInternalSecret`: resolved via ConfigManager with ConfigSource.env to prevent DB fallback.
 */
export interface VaultSettingsService {
  getSettings(): Promise<VaultSettings>;
}

class VaultSettingsServiceImpl implements VaultSettingsService {
  async getSettings(): Promise<VaultSettings> {
    // Resolve the feature flag through ConfigManager so that DB-stored values
    // take precedence over the env var (consistent with other app:* flags).
    const enabled = configManager.getConfig('app:vaultEnabled') ?? false;

    // managerEndpoint and managerInternalSecret are security-sensitive values
    // that must never be written to the database. Pass ConfigSource.env to
    // configManager to guarantee env-only resolution with no DB fallback.
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
