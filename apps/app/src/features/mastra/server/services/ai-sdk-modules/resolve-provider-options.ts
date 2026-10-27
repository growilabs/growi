import type { ModelProviderOptions } from '~/features/mastra/interfaces/allowed-model';
import { parseModelKey } from '~/features/mastra/interfaces/model-key';

import { getAllowedModels } from './llm-providers/config';

// Look up the provider options for an ALREADY-RESOLVED effective modelKey. The
// caller resolves the effective modelKey exactly once (resolveEffectiveModelKey —
// the single allow-list rounding checkpoint, which collapses an out-of-allowlist /
// omitted key to the effective default and warns at most once) and threads the
// result here, so this performs NO resolution / rounding / warning of its own: it
// is a pure allow-list lookup. Keeping rounding out of this function is what stops
// the fallback from being re-evaluated (and re-warned) on a second, independent
// pass.
//
// The key is parsed into its (provider, modelId) pair and matched against the
// allow-list on BOTH fields (Req 2.8 / D1): the same modelId may coexist under
// different providers (Req 2.3), so matching on modelId alone would return the
// wrong provider's options. Options are always per used model; because the caller
// has already collapsed a rejected key to the effective default, the default
// model's options apply for such a request (Req 4.6). Returns {} when the key is
// unparseable, the entry is absent, or the entry declares no options (defensive
// fallback — never throws).
export const getProviderOptionsForModel = (
  modelKey: string,
): ModelProviderOptions => {
  const parsed = parseModelKey(modelKey);
  if (parsed == null) {
    return {};
  }

  return (
    getAllowedModels().find(
      (m) => m.provider === parsed.provider && m.modelId === parsed.modelId,
    )?.providerOptions ?? {}
  );
};
