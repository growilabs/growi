import type { MastraModelConfig } from '@mastra/core/llm';

import { parseModelKey } from '~/features/mastra/interfaces/model-key';

import { modelResolvers } from './llm-providers';
import { resolveEffectiveModelKey } from './llm-providers/effective-model-key';
import {
  addResolvedModelToCache,
  getResolvedModelFromCache,
} from './resolved-model-cache';

export const resolveMastraModel = async (
  modelKey?: string,
): Promise<MastraModelConfig> => {
  // Resolve (and allow-list validate) the effective modelKey first. The client
  // value is never trusted: out-of-allowlist / omitted keys fall back to the
  // effective default; an empty available set throws (Req 4.6). This is the single
  // validation checkpoint; the value returned here is always a built modelKey.
  const effectiveKey = resolveEffectiveModelKey(modelKey);

  // Cache keyed by the effective modelKey (Req 4.3): two requests that collapse to
  // the same effective key share a single build. Checked BEFORE parsing so the
  // steady-state hit path (every repeat request) is a straight-line lookup with no
  // redundant parse — a cached key was necessarily parseable when it was stored.
  const cached = getResolvedModelFromCache(effectiveKey);
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
  // 2.3, 4.3). The resolver is async because it dynamically imports only its own
  // `@ai-sdk/*` SDK (so the unused providers' graphs never load); that build cost
  // is paid once per distinct effective key (cache miss) and never on the hot
  // cached path above.
  //
  // The IN-FLIGHT Promise is what gets cached, and it is registered while this
  // function is still executing synchronously (no await sits between the cache
  // check above and this set). That makes the build single-flight: concurrent
  // misses on the same key share one build instead of each constructing a model,
  // and a clearResolvedMastraModelCache() while the build is pending discards
  // the pending entry — a model built from pre-save config can never repopulate
  // the cache after a settings save. A rejected build (provider
  // misconfiguration) is evicted by the cache itself, so nothing stays cached
  // and a config fix takes effect on the next call.
  const modelPromise = modelResolvers[parsed.provider](parsed.modelId);
  addResolvedModelToCache(effectiveKey, modelPromise);
  // `await` (rather than returning the Promise raw) keeps this frame on the
  // rejection stack trace; the registration above already happened, so the
  // single-flight guarantee is unaffected.
  return await modelPromise;
};
