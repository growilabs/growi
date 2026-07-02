import type { AiProvider } from '../../../interfaces/ai-provider';
import { RefreshedModelCatalog } from '../../models/refreshed-model-catalog';
import { getSelectableModelIds } from './model-catalog';

/**
 * Resolve the selectable model ids for a provider from the EFFECTIVE catalog:
 * the persisted refreshed catalog when a runtime refresh has succeeded (Req 9),
 * otherwise the bundled committed asset (Req 9.5).
 *
 * The read itself performs no external communication — it consults local
 * storage (MongoDB) and the statically imported bundled asset only (Req 2).
 * Kept separate from model-catalog.ts so the bundled read stays a pure,
 * I/O-free module.
 */
export const getEffectiveSelectableModelIds = async (
  provider: AiProvider,
): Promise<string[]> => {
  const refreshed = await RefreshedModelCatalog.getSingleton();

  if (refreshed != null) {
    // Same controlled widening as the bundled read: the stored value is a
    // validated ModelCatalog, indexable only by catalog-backed providers, so a
    // catalog-less provider (e.g. 'azure-openai') falls back to [] (Req 3.1).
    const models: Record<string, readonly string[]> = refreshed.models;
    return [...(models[provider] ?? [])];
  }

  return getSelectableModelIds(provider);
};
