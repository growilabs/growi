import type { MastraModelConfig } from '@mastra/core/llm';

import { parseModelKey } from '~/features/mastra/interfaces/model-key';

import { modelResolvers } from './llm-providers';
import { resolveEffectiveModelKey } from './llm-providers/effective-model-key';

// Cache each resolved model so the native provider object is built once per
// distinct effective modelKey and reused across requests. The Map replaces the
// former single-slot memo because one app now serves many models across many
// providers; caching per modelKey preserves the Azure+Entra per-model token cache
// (the bearer token provider is captured inside each cached MastraModelConfig, so
// it is not rebuilt while that model stays cached — see research.md §7). On
// misconfiguration the function throws (and caches nothing), so a config fix takes
// effect on the next call without a restart.
const resolvedModelCache = new Map<string, MastraModelConfig>();

export const resolveMastraModel = (modelKey?: string): MastraModelConfig => {
  // Resolve (and allow-list validate) the effective modelKey first. The client
  // value is never trusted: out-of-allowlist / omitted keys fall back to the
  // effective default; an empty available set throws (Req 4.6). This is the single
  // validation checkpoint; the value returned here is always a built modelKey.
  const effectiveKey = resolveEffectiveModelKey(modelKey);

  // Cache keyed by the effective modelKey (Req 4.3): two requests that collapse to
  // the same effective key share a single build. Checked BEFORE parsing so the
  // steady-state hit path (every repeat request) is a straight-line lookup with no
  // redundant parse — a cached key was necessarily parseable when it was stored.
  const cached = resolvedModelCache.get(effectiveKey);
  if (cached != null) {
    return cached;
  }

  // Cache miss: parse the (provider, modelId) pair from the effective key. Because
  // resolveEffectiveModelKey always returns a key built by buildModelKey, this
  // parse succeeds in practice — the null branch is a defensive guard against a
  // malformed key rather than a reachable path, and it throws (caching nothing)
  // rather than dispatching on an undefined provider. The message names the key
  // only — no secrets, no config values (Req 1.9).
  const parsed = parseModelKey(effectiveKey);
  if (parsed == null) {
    throw new Error(
      `Cannot resolve the Mastra model: effective modelKey "${effectiveKey}" could not be parsed into a (provider, modelId) pair`,
    );
  }

  // Generic dispatch: the parsed provider's resolver builds its own model from the
  // BARE modelId + its own config. Dispatching by the parsed provider (not by the
  // modelId) is what lets the same modelId coexist under different providers (Req
  // 2.3, 4.3). The chosen resolver throws on its own misconfiguration — nothing is
  // cached in that case, so a config fix takes effect on the next call.
  const model = modelResolvers[parsed.provider](parsed.modelId);
  resolvedModelCache.set(effectiveKey, model);
  return model;
};

// Discard every cached model so the next resolveMastraModel() rebuilds from the
// current config. Called when AI settings are saved (locally) or a
// `configUpdated` s2s message arrives (other instances), giving restart-free
// reflection of updated settings. Caching itself is preserved — rebuilding on
// every request is undesirable because the Azure+Entra resolver holds a per-model
// token cache inside each cached object (see research.md §7).
export const clearResolvedMastraModelCache = (): void => {
  resolvedModelCache.clear();
};
