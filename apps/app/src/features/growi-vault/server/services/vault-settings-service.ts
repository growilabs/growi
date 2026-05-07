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
 * - `managerEndpoint`: read from process.env only — intentionally NOT stored in DB.
 * - `managerInternalSecret`: read from process.env only — intentionally NOT stored in DB.
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
    // that must never be written to the database. Read them directly from the
    // process environment to guarantee they stay env-only.
    const managerEndpoint = process.env.VAULT_MANAGER_ENDPOINT ?? '';
    const managerInternalSecret =
      process.env.VAULT_MANAGER_INTERNAL_SECRET ?? '';

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
