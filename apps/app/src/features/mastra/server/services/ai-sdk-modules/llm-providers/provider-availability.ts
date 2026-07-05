import type { AiProvider } from '~/features/mastra/interfaces/ai-provider';
import { AI_PROVIDERS } from '~/features/mastra/interfaces/ai-provider';
import type { AllowedModel } from '~/features/mastra/interfaces/allowed-model';
import type {
  ProviderAvailability,
  ProviderUnavailableReason,
} from '~/features/mastra/interfaces/provider-availability-rule';
import { evaluateProviderAvailability } from '~/features/mastra/interfaces/provider-availability-rule';

import { getAllowedModels, getApiKey, getProviderSettings } from './config';
import { clearAvailabilityLogDedup, warnOnce } from './warn-dedup';

// The single availability predicate for the AI providers. "Available" means the
// admin turned the provider ON (enabled) AND it is configured (its required
// connection settings are present). Every consumer that needs to know which
// providers / models an end user may reach (is-ai-configured, get-models,
// effective-model-key) derives from here, so the enabled-and-configured judgement
// cannot drift between call sites (design D3).
//
// The rule itself lives in the client-safe pure module
// `~/features/mastra/interfaces/provider-availability-rule` so the server and the
// admin client share ONE definition. This module is the server adapter: it GATHERS
// the inputs from the config accessors, DELEGATES the verdict to the pure rule, and
// owns the runtime side effect (the dedup'd misconfiguration warn).
//
// Dependency direction: config accessor -> provider-availability -> effective-key
// resolution. This module therefore imports the config accessors (never the other
// way round) and only shares the warn-dedup registry with them (design
// "Allowed Dependencies"). It must NOT import effective-model-key or
// is-ai-configured — those import IT.

// Re-exported so server consumers/tests can keep importing the availability types
// from this module; the rule (and its types) now live in the interfaces layer.
export type { ProviderAvailability, ProviderUnavailableReason };

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

/**
 * Availability of a single provider: enabled AND configured. Preconditions: none
 * (safe on fully-unset config). A `disabled` verdict is silent; a misconfiguration
 * on an enabled provider emits a dedup'd warn as a side effect (Req 6.1).
 */
export const getProviderAvailability = (
  provider: AiProvider,
): ProviderAvailability => {
  const enabled = getProviderSettings(provider)?.enabled === true;
  const hasApiKey = getApiKey(provider) != null;
  // Only consulted for the azure-openai verdict; harmless (undefined) otherwise.
  const azureOpenaiSettings =
    getProviderSettings('azure-openai')?.azureOpenaiSettings;

  const availability = evaluateProviderAvailability({
    provider,
    enabled,
    hasApiKey,
    azureOpenaiSettings,
  });

  if (!availability.available && availability.reason !== 'disabled') {
    warnMisconfigured(provider, availability.reason);
  }

  return availability;
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
