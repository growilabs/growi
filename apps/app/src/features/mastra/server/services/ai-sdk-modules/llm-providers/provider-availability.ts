import type { AiProvider } from '~/features/mastra/interfaces/ai-provider';
import { AI_PROVIDERS } from '~/features/mastra/interfaces/ai-provider';
import type { AllowedModel } from '~/features/mastra/interfaces/allowed-model';
import type { ProviderAvailability } from '~/features/mastra/interfaces/provider-availability-rule';
import { evaluateProviderAvailability } from '~/features/mastra/interfaces/provider-availability-rule';

import { getAllowedModels, getApiKey, getProviderSettings } from './config';
import { warnOnce } from './warn-dedup';

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
 * The allow-list entries whose owning provider is available AND whose modelId is
 * usable — implements the Req 6.1 exclusion of misconfigured/disabled providers'
 * models. Always a subset of getAllowedModels(), preserving its order.
 *
 * The modelId guard is deliberate: getAllowedModels() KEEPS a valid-provider entry
 * whose modelId is missing/blank so the admin GET can surface it as a fixable form
 * row. But env-provided allow-lists (AI_ALLOWED_MODELS) bypass the PUT validator
 * entirely, so such an entry would otherwise reach chat, where buildModelKey forms
 * the literal key `<provider>/undefined` (or `<provider>/`) and sends the string
 * modelId verbatim to the provider (a 404 on every request). Chat must never offer
 * one — exclude it here rather than in getAllowedModels, which keeps it visible.
 */
export const getAvailableModels = (): AllowedModel[] => {
  const availableProviders = new Set(getAvailableProviders());
  return getAllowedModels().filter(
    (model) =>
      availableProviders.has(model.provider) &&
      typeof model.modelId === 'string' &&
      model.modelId.trim() !== '',
  );
};
