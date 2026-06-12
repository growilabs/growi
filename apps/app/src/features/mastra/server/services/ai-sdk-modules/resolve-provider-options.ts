import type { JSONValue } from 'ai';

import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:features:mastra:resolve-provider-options');

// AI SDK `providerOptions` shape: provider namespace -> option map. Operators
// supply the full, provider-namespaced object as JSON (variant A), so this
// feature carries no per-vendor mapping logic.
export type MastraProviderOptions = Record<string, Record<string, JSONValue>>;

const isProviderOptions = (value: unknown): value is MastraProviderOptions => {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    return false;
  }
  // Each top-level entry must itself be a (non-array) option object.
  return Object.values(value).every(
    (v) => typeof v === 'object' && v != null && !Array.isArray(v),
  );
};

// Resolve the provider options applied to the mastra chat stream call from the
// single `mastra:llmProviderOptions` JSON env var. Fails soft: a malformed or
// non-provider-namespaced value is ignored (returns `{}`) with a warning rather
// than failing the chat request, since provider options are tuning, not
// correctness-critical (Req 6.4). Unknown provider namespaces are harmless — the
// AI SDK reads only the active provider's namespace.
export const resolveProviderOptions = (): MastraProviderOptions => {
  const raw = configManager.getConfig('mastra:llmProviderOptions');
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
      'MASTRA_LLM_PROVIDER_OPTIONS is not valid JSON; ignoring provider options',
      err,
    );
    return {};
  }

  if (!isProviderOptions(parsed)) {
    logger.warn(
      'MASTRA_LLM_PROVIDER_OPTIONS must be a provider-namespaced object (e.g. {"openai":{...}}); ignoring',
    );
    return {};
  }

  return parsed;
};
