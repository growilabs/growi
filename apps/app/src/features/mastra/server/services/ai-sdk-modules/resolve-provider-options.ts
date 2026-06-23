import type { JSONValue } from 'ai';

import { getAllowedModels } from './llm-providers/config';

// AI SDK `providerOptions` shape: provider namespace -> option map. Operators
// supply the full, provider-namespaced object as JSON per allowed-model entry, so
// this feature carries no per-vendor mapping logic. Same shape as the cross-layer
// ModelProviderOptions DTO.
export type MastraProviderOptions = Record<string, Record<string, JSONValue>>;

// Look up the provider options for an ALREADY-RESOLVED effective model id. The
// caller resolves the effective model exactly once (resolveEffectiveModel — the
// single allow-list rounding checkpoint, which collapses an out-of-allowlist /
// omitted modelId to the default and warns at most once) and threads the result
// here, so this performs NO resolution / rounding / warning of its own: it is a
// pure allow-list lookup. Keeping rounding out of this function is what stops the
// fallback from being re-evaluated (and re-warned) on a second, independent pass.
//
// There is no global, uniformly-applied options value (Req 2.5): options are always
// per used model, and because the caller has already collapsed a rejected id to the
// default, the default model's options apply for such a request (Req 4.4). Returns
// {} when the entry declares no options (or, defensively, is not found).
export const getProviderOptionsForModel = (
  effectiveModelId: string,
): MastraProviderOptions =>
  getAllowedModels().find((m) => m.model === effectiveModelId)
    ?.providerOptions ?? {};
