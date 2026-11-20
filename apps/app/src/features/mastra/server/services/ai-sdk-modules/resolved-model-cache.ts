import type { MastraModelConfig } from '@mastra/core/llm';

// Cache each model build as its IN-FLIGHT Promise (single-flight) so the native
// provider object is built once per distinct (provider, effective model) and
// reused across requests — including requests that arrive while the first build
// is still awaiting its lazily-imported provider SDK: they share the pending
// Promise instead of starting a duplicate build. Holding the Promise (not the
// settled value) also keeps clearing correct mid-build: a clear discards the
// pending entry too, so a model built from pre-save config can never repopulate
// the cache after a settings save. The Map replaces the former single-slot memo
// because one app now serves many models; caching per model preserves the
// Azure+Entra per-model token cache (the bearer token provider is captured
// inside each cached model, so it is not rebuilt while that model stays cached
// — see research.md §7).
//
// This cache lives in its own module — with a type-only @mastra import, erased
// at build — so that consumers that only need cache INVALIDATION (boot-path
// code like model-config-sync, and put-ai-settings) can import it without
// statically pulling the @ai-sdk provider graph behind resolve-mastra-model.
// Import clearResolvedMastraModelCache from HERE, never from
// resolve-mastra-model (guarded by no-eager-ai-imports.spec.ts).
const resolvedModelCache = new Map<string, Promise<MastraModelConfig>>();

export const getResolvedModelFromCache = (
  cacheKey: string,
): Promise<MastraModelConfig> | undefined => resolvedModelCache.get(cacheKey);

export const addResolvedModelToCache = (
  cacheKey: string,
  modelPromise: Promise<MastraModelConfig>,
): void => {
  resolvedModelCache.set(cacheKey, modelPromise);
  // A failed build must never be served from the cache (a config fix takes
  // effect on the very next call), so evict on rejection — but only while this
  // exact entry is still current: a clear + successful rebuild may have
  // replaced it while it was pending, and that fresh entry must survive.
  modelPromise.catch(() => {
    if (resolvedModelCache.get(cacheKey) === modelPromise) {
      resolvedModelCache.delete(cacheKey);
    }
  });
};

// Discard every cached model — including builds still in flight — so the next
// resolveMastraModel() rebuilds from the current config. Called when AI
// settings are saved (locally) or a `configUpdated` s2s message arrives (other
// instances), giving restart-free reflection of updated settings (Req 1.2).
// Caching itself is preserved — rebuilding on every request is undesirable
// because the Azure+Entra resolver holds a per-model token cache inside each
// cached object (see research.md §7).
export const clearResolvedMastraModelCache = (): void => {
  resolvedModelCache.clear();
};
