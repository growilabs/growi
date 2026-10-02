import type { AiProvider } from './ai-provider';
import type { AzureOpenaiConfig } from './azure-openai-config';

/**
 * Non-secret per-provider settings, stored together as one `ai:providers`
 * Record (secret material lives separately in `ai:providerApiKeys` — the
 * secret/non-secret key split lets the admin API return this object as-is).
 */
export interface AiProviderSettings {
  /** Admin's enable toggle. Omitted = false (disabled). */
  readonly enabled?: boolean;
  /** Connection settings — only meaningful for the 'azure-openai' entry. */
  readonly azureOpenaiSettings?: AzureOpenaiConfig;
}

/**
 * Value shape of the `ai:providers` config key (env var `AI_PROVIDERS`, JSON).
 * Keyed by AiProvider, so each supported provider has at most one entry
 * (fixed-slot model — Req 1.2); a missing entry means "never configured".
 */
export type AiProvidersConfig = Partial<Record<AiProvider, AiProviderSettings>>;

/**
 * Value shape of the `ai:providerApiKeys` config key (env var
 * `AI_PROVIDER_API_KEYS`, JSON; isSecret). One API key per provider. Values
 * are never returned by APIs — only a per-provider `isApiKeySet` flag is.
 */
export type AiProviderApiKeys = Partial<Record<AiProvider, string>>;
