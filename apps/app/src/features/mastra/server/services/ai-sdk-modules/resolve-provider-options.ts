import type { JSONValue } from 'ai';

import { isProviderNamespacedObject } from '~/features/mastra/utils/provider-options-validation';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:features:mastra:resolve-provider-options');

// AI SDK `providerOptions` shape: provider namespace -> option map. Operators
// supply the full, provider-namespaced object as JSON (variant A), so this
// feature carries no per-vendor mapping logic.
export type MastraProviderOptions = Record<string, Record<string, JSONValue>>;

// Typed guard over the shared shape predicate — single source of truth with the
// FE/BE form validator (isValidProviderOptionsJson), narrowing to the AI SDK's
// MastraProviderOptions. The form rejects this shape up front; this stays as
// defense-in-depth for a value set directly via the env var (which bypasses the form).
const isProviderOptions = (value: unknown): value is MastraProviderOptions =>
  isProviderNamespacedObject(value);

// Resolve the provider options applied to the mastra chat stream call from the
// single `ai:providerOptions` JSON env var. Fails soft: a malformed or
// non-provider-namespaced value is ignored (returns `{}`) with a warning rather
// than failing the chat request, since provider options are tuning, not
// correctness-critical (Req 6.4). Unknown provider namespaces are harmless — the
// AI SDK reads only the active provider's namespace.
export const resolveProviderOptions = (): MastraProviderOptions => {
  const raw = configManager.getConfig('ai:providerOptions');
  if (raw == null || raw === '') {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Include the parse error so operators can locate the broken position in a
    // long JSON value (the value is not a secret).
    logger.warn(
      'AI_PROVIDER_OPTIONS is not valid JSON; ignoring provider options',
      err,
    );
    return {};
  }

  if (!isProviderOptions(parsed)) {
    logger.warn(
      'AI_PROVIDER_OPTIONS must be a provider-namespaced object (e.g. {"openai":{...}}); ignoring',
    );
    return {};
  }

  return parsed;
};
