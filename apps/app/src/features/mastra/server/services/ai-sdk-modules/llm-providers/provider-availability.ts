import type { AiProvider } from '~/features/mastra/interfaces/ai-provider';
import { AI_PROVIDERS } from '~/features/mastra/interfaces/ai-provider';
import type { AllowedModel } from '~/features/mastra/interfaces/allowed-model';

import { getAllowedModels, getApiKey, getProviderSettings } from './config';
import { clearAvailabilityLogDedup, warnOnce } from './warn-dedup';

// The single availability predicate for the AI providers. "Available" means the
// admin turned the provider ON (enabled) AND it is configured (its required
// connection settings are present). Every consumer that needs to know which
// providers / models an end user may reach (is-ai-configured, get-models,
// effective-model-key) derives from here, so the enabled-and-configured judgement
// cannot drift between call sites (design D3).
//
// Dependency direction: config accessor -> provider-availability -> effective-key
// resolution. This module therefore imports the config accessors (never the other
// way round) and only shares the warn-dedup registry with them (design
// "Allowed Dependencies"). It must NOT import effective-model-key or
// is-ai-configured — those import IT.

/**
 * Why an enabled provider is nonetheless unavailable.
 * - `disabled`: the admin has not turned the provider on (enabled !== true). This
 *   is the administrator's intent, so it is NOT logged (Req 1.6).
 * - `missing-api-key`: a key-required provider has no API key (Req 6.1 — warned).
 * - `missing-azure-endpoint`: azure-openai has neither resourceName nor baseURL
 *   (Req 6.1 — warned).
 */
export type ProviderUnavailableReason =
  | 'disabled'
  | 'missing-api-key'
  | 'missing-azure-endpoint';

type ProviderAvailability =
  | { available: true }
  | { available: false; reason: ProviderUnavailableReason };

// Emit the misconfiguration warn for an enabled-but-broken provider, deduplicated
// per (provider, reason) so a per-request availability check does not flood the log
// (design 6.1). `disabled` is never routed here — it is admin intent, not a fault.
// The message carries only the provider name and the reason: no key value and no
// config value ever appear (Req 1.9). The dedup registry (and its reset) is shared
// with the config accessors' malformed-config warns via warn-dedup.
const warnMisconfigured = (
  provider: AiProvider,
  reason: 'missing-api-key' | 'missing-azure-endpoint',
): void => {
  warnOnce(
    `provider:${provider}|${reason}`,
    `AI provider "${provider}" is enabled but misconfigured (${reason}); its allowed models are excluded from the model selector until its connection settings are completed`,
  );
};

// azure-openai is the one non-uniform provider: it needs an endpoint (resourceName
// or baseURL) regardless of auth method, and its API key is waived under Microsoft
// Entra ID (ambient managed identity). This mirrors resolveAzureOpenaiModel's
// real success/throw path so availability agrees with what the resolver would do
// (endpoint checked first, so a key-present-but-endpoint-missing deployment reads
// as missing-azure-endpoint, not missing-api-key).
const getAzureAvailability = (): ProviderAvailability => {
  const azureOpenaiSettings =
    getProviderSettings('azure-openai')?.azureOpenaiSettings;

  if (
    azureOpenaiSettings?.resourceName == null &&
    azureOpenaiSettings?.baseURL == null
  ) {
    warnMisconfigured('azure-openai', 'missing-azure-endpoint');
    return { available: false, reason: 'missing-azure-endpoint' };
  }

  if (
    azureOpenaiSettings.useEntraId !== true &&
    getApiKey('azure-openai') == null
  ) {
    warnMisconfigured('azure-openai', 'missing-api-key');
    return { available: false, reason: 'missing-api-key' };
  }

  return { available: true };
};

/**
 * Availability of a single provider: enabled AND configured. Preconditions: none
 * (safe on fully-unset config). A `disabled` verdict is silent; a misconfiguration
 * on an enabled provider emits a dedup'd warn as a side effect (Req 6.1).
 */
export const getProviderAvailability = (
  provider: AiProvider,
): ProviderAvailability => {
  if (getProviderSettings(provider)?.enabled !== true) {
    return { available: false, reason: 'disabled' };
  }

  if (provider === 'azure-openai') {
    return getAzureAvailability();
  }

  // Key-based providers (openai / anthropic / google) require only an API key.
  if (getApiKey(provider) == null) {
    warnMisconfigured(provider, 'missing-api-key');
    return { available: false, reason: 'missing-api-key' };
  }

  return { available: true };
};

/**
 * The enabled-and-configured providers, in the fixed declaration order of
 * AI_PROVIDERS. Empty when nothing is configured (no throw).
 */
export const getAvailableProviders = (): AiProvider[] =>
  AI_PROVIDERS.filter(
    (provider) => getProviderAvailability(provider).available,
  );

/**
 * The allow-list entries whose owning provider is available — implements the Req
 * 6.1 exclusion of misconfigured/disabled providers' models. Always a subset of
 * getAllowedModels(), preserving its order.
 */
export const getAvailableModels = (): AllowedModel[] => {
  const availableProviders = new Set(getAvailableProviders());
  return getAllowedModels().filter((model) =>
    availableProviders.has(model.provider),
  );
};

// Re-exported so consumers of this module reset the misconfiguration-warn dedup
// through one surface. It is the SAME registry the config accessors use (defined
// in warn-dedup); this is not a second/duplicate reset. Wiring it into
// put-ai-settings / the s2s configUpdated handler is a later task.
export { clearAvailabilityLogDedup };
