import { ConfigSource } from '@growi/core/dist/interfaces';

import type { AiProvider } from '~/features/mastra/interfaces/ai-provider';
import type { AllowedModel } from '~/features/mastra/interfaces/allowed-model';
import type {
  AiProviderApiKeys,
  AiProviderSettings,
  AiProvidersConfig,
} from '~/features/mastra/interfaces/provider-settings';
import { configManager } from '~/server/service/config-manager';

import { infoOnce, warnOnce } from './warn-dedup';

// Per-provider config accessors for the model resolvers. This is the lowest layer:
// it reads config keys and applies defensive shape guards, but never depends on
// provider-availability / effective-model-key (the dependency direction is
// config accessor -> availability -> effective-key resolution). It may only share
// the warn-dedup registry with availability.
//
// config-manager does NOT runtime-validate values: the loader JSON-parses env vars
// and casts the result unchecked, so any getConfig result may violate its declared
// type. Every accessor therefore reads through `unknown` and treats the runtime
// shape guard as the single source of truth. A malformed value is treated as
// "unset" (fail soft) with a dedup'd warn so the misconfiguration is observable
// rather than silently disabling AI (fail-silent is deliberately excluded).

// The config keys these accessors read. All three are non-env-only-by-default
// (ai:providers / ai:providerApiKeys are env-only only while env-only mode is on),
// so their resolved value is `DB ?? env` — which makes env/DB shadowing possible.
type AiValueConfigKey =
  | 'ai:providers'
  | 'ai:providerApiKeys'
  | 'ai:allowedModels';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Whether an env-layer value represents a value the operator actually set (as
// opposed to the key's default). The env layer is ALWAYS populated by the loader
// with the key's default when the env var is unset (null for ai:providers /
// ai:providerApiKeys, [] for ai:allowedModels), so a plain `!= null` check would
// treat an unset env var as "defined" and mis-report normal admin-saved DB values
// as shadowing. An empty object/array is not a meaningful override, so it is
// treated as unset for shadowing purposes.
const isMeaningfulEnvValue = (value: unknown): boolean => {
  if (value == null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return true;
};

// Emit a dedup'd info when the operator has set an env var for `key` but a DB value
// shadows it. config-manager resolves these keys as `DB ?? env`, so once a DB value
// exists the env value is inert; this is the observation point for "I changed the
// env var but nothing happened". Env-only keys under env-only mode resolve to the
// env value (resolved === the env value by reference), so they are correctly NOT
// reported here. The value itself is never logged (design "シャドーイングの規則":
// 値そのものは出力しない).
const reportEnvShadowingIfNeeded = (key: AiValueConfigKey): void => {
  const dbValue = configManager.getConfig(key, ConfigSource.db);
  if (dbValue == null) {
    return;
  }
  const envValue = configManager.getConfig(key, ConfigSource.env);
  if (!isMeaningfulEnvValue(envValue)) {
    return;
  }
  // The resolved value is reference-identical to whichever layer won. If it is
  // not the env value, the DB value won and the env value is shadowed.
  if (configManager.getConfig(key) !== envValue) {
    infoOnce(
      `${key}|env-shadowed-by-db`,
      `The environment variable for config "${key}" is shadowed by a database value and no longer takes effect; edit it from the admin AI settings, or use env-only mode to keep it under environment control`,
    );
  }
};

// Read ai:providers, guarding against a malformed (non-object) value.
const readProvidersConfig = (): AiProvidersConfig | undefined => {
  reportEnvShadowingIfNeeded('ai:providers');
  const value: unknown = configManager.getConfig('ai:providers');
  if (value == null) {
    return undefined;
  }
  if (!isRecord(value)) {
    warnOnce(
      'ai:providers|malformed',
      'Config "ai:providers" has an invalid shape (expected an object); treating all AI providers as unconfigured',
    );
    return undefined;
  }
  // Guarded to a plain object. Per-provider entry shapes are not validated here;
  // each resolver guards its own fields.
  return value as AiProvidersConfig;
};

// Read ai:providerApiKeys, guarding against a malformed (non-object) value. The
// warn never contains any key material (design R1.9): config key + reason only.
const readProviderApiKeys = (): AiProviderApiKeys | undefined => {
  reportEnvShadowingIfNeeded('ai:providerApiKeys');
  const value: unknown = configManager.getConfig('ai:providerApiKeys');
  if (value == null) {
    return undefined;
  }
  if (!isRecord(value)) {
    warnOnce(
      'ai:providerApiKeys|malformed',
      'Config "ai:providerApiKeys" has an invalid shape (expected an object); treating all provider API keys as unconfigured',
    );
    return undefined;
  }
  return value as AiProviderApiKeys;
};

/** The non-secret settings for `provider`, or undefined when it has no entry. */
export const getProviderSettings = (
  provider: AiProvider,
): AiProviderSettings | undefined => readProvidersConfig()?.[provider];

/** The stored API key for `provider`, or undefined when none is set. */
export const getApiKey = (provider: AiProvider): string | undefined =>
  readProviderApiKeys()?.[provider];

// The API key is mandatory for the key-based providers. The message names only the
// provider and the env var (never the key value or its absence in value form) so an
// error log / stack trace cannot leak secret material (R1.9).
export const requireApiKey = (provider: AiProvider): string => {
  const apiKey = getApiKey(provider);
  if (apiKey == null) {
    throw new Error(
      `API key for provider "${provider}" is not configured (set it via the admin AI settings or the AI_PROVIDER_API_KEYS environment variable)`,
    );
  }
  return apiKey;
};

// The cross-provider allow-list of models the operator permits. Returns it verbatim
// (falling back to []); never synthesises entries. A malformed (non-array) value is
// coerced to [] with a dedup'd warn — coerced rather than thrown because this feeds
// isAiConfigured(), a should-be-pure boolean predicate: a malformed value reads as
// [] = AI unconfigured (fail soft). The warn replaces the former fail-silent
// coercion (design "fail-silent の排除").
export const getAllowedModels = (): AllowedModel[] => {
  reportEnvShadowingIfNeeded('ai:allowedModels');
  const value: unknown = configManager.getConfig('ai:allowedModels');
  if (Array.isArray(value)) {
    return value;
  }
  if (value != null) {
    warnOnce(
      'ai:allowedModels|malformed',
      'Config "ai:allowedModels" has an invalid shape (expected an array); treating the allow-list as empty',
    );
  }
  return [];
};
