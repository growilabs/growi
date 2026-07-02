import type { AiProvider } from '../../../interfaces/ai-provider';
// Statically imported committed artifact (vendored from models.dev at the
// ingest step, not at build or runtime). Reading it is the ONLY data source at
// runtime — there is no network/fs/config access here, which is what makes the
// list provision fully offline (Req 2.1/2.2/2.3).
import catalog from './model-catalog-data.json' with { type: 'json' };

// The auto-inferred type of `catalog.models` only covers the catalog-backed
// providers (openai/anthropic/google) and cannot be indexed by a general
// AiProvider (which includes 'azure-openai'). Treat it as the design-prescribed
// `Record<string, readonly string[]>` shape of our own generated asset.
const models: Record<string, readonly string[]> = catalog.models;

/**
 * Return the selectable model ids for the given provider from the committed
 * catalog. Synchronous and offline: performs no network or filesystem I/O.
 * Providers absent from the catalog (e.g. 'azure-openai') fail soft with an
 * empty array (Error Handling: missing/corrupt artifact → `?? []`).
 */
export const getSelectableModelIds = (provider: AiProvider): string[] => {
  // Spread into a fresh mutable array so callers cannot mutate the shared
  // imported catalog.
  return [...(models[provider] ?? [])];
};
