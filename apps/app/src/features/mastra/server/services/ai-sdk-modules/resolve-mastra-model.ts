import type { MastraModelConfig } from '@mastra/core/llm';

import {
  AI_PROVIDERS,
  isAiProvider,
} from '~/features/mastra/interfaces/ai-provider';
import { configManager } from '~/server/service/config-manager';

import { modelResolvers } from './llm-providers';
import { resolveEffectiveModelId } from './llm-providers/config';

// Cache each resolved model so the native provider object is built once per
// distinct (provider, effective model) and reused across requests. The Map
// replaces the former single-slot memo because one app now serves many models;
// caching per model preserves the Azure+Entra per-model token cache (the bearer
// token provider is captured inside each cached MastraModelConfig, so it is not
// rebuilt while that model stays cached — see research.md §7). On misconfiguration
// the function throws (and caches nothing), so a config fix takes effect on the
// next call without a restart.
const resolvedModelCache = new Map<string, MastraModelConfig>();

export const resolveMastraModel = (modelId?: string): MastraModelConfig => {
  // Resolve (and allow-list validate) the effective model id first. The client
  // value is never trusted: out-of-allowlist / omitted ids fall back to the
  // default; an empty allow-list throws (Req 4.1).
  const effectiveModelId = resolveEffectiveModelId(modelId);

  // `ai:provider` has no default (undefined when unset), and env-loaded config is
  // not runtime-validated against the union, so re-validate here (Req 1.4).
  const provider = configManager.getConfig('ai:provider');
  if (!isAiProvider(provider)) {
    throw new Error(
      `Unsupported Mastra LLM provider "${provider}" (expected one of: ${AI_PROVIDERS.join(', ')})`,
    );
  }

  const cacheKey = `${provider}:${effectiveModelId}`;
  const cached = resolvedModelCache.get(cacheKey);
  if (cached != null) {
    return cached;
  }

  // Generic dispatch: each provider builds its own model from the effective
  // model id + its own config. The chosen resolver throws on its own
  // misconfiguration — nothing is cached in that case, so a config fix takes
  // effect on the next call.
  const model = modelResolvers[provider](effectiveModelId);
  resolvedModelCache.set(cacheKey, model);
  return model;
};

// Discard every cached model so the next resolveMastraModel() rebuilds from the
// current config. Called when AI settings are saved (locally) or a
// `configUpdated` s2s message arrives (other instances), giving restart-free
// reflection of updated settings (Req 1.2). Caching itself is preserved —
// rebuilding on every request is undesirable because the Azure+Entra resolver
// holds a per-model token cache inside each cached object (see research.md §7).
export const clearResolvedMastraModelCache = (): void => {
  resolvedModelCache.clear();
};
