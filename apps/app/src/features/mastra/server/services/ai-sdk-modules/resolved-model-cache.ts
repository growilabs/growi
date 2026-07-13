import type { MastraModelConfig } from '@mastra/core/llm';

// Cache each resolved model so the native provider object is built once per
// distinct (provider, effective model) and reused across requests. The Map
// replaces the former single-slot memo because one app now serves many models;
// caching per model preserves the Azure+Entra per-model token cache (the bearer
// token provider is captured inside each cached MastraModelConfig, so it is not
// rebuilt while that model stays cached — see research.md §7).
//
// This cache lives in its own module — with a type-only @mastra import, erased
// at build — so that consumers that only need cache INVALIDATION (boot-path
// code like model-config-sync, and put-ai-settings) can import it without
// statically pulling the @ai-sdk provider graph behind resolve-mastra-model.
// Import clearResolvedMastraModelCache from HERE, never from
// resolve-mastra-model (guarded by no-eager-ai-imports.spec.ts).
const resolvedModelCache = new Map<string, MastraModelConfig>();

export const getResolvedModelFromCache = (
  cacheKey: string,
): MastraModelConfig | undefined => resolvedModelCache.get(cacheKey);

export const addResolvedModelToCache = (
  cacheKey: string,
  model: MastraModelConfig,
): void => {
  resolvedModelCache.set(cacheKey, model);
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
