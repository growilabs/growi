import { prisma } from '~/utils/prisma';

import type { AiProvider } from '../../../interfaces/ai-provider';
import {
  BUNDLED_CATALOG_GENERATED_AT,
  getSelectableModelIds,
} from './model-catalog';

/**
 * Resolve the selectable model ids for a provider from the EFFECTIVE catalog:
 * the NEWER of the persisted refreshed catalog (Req 9) and the bundled
 * committed asset (Req 9.5). Concretely:
 *
 * - no refreshed snapshot → bundled (the offline default)
 * - refreshed snapshot present → the refreshed one, UNLESS the bundled asset is
 *   strictly newer (an image update shipped a fresher catalog after the last
 *   refresh) — then the bundled one wins until the next successful refresh
 *
 * The read itself performs no external communication — it consults local
 * storage (MongoDB) and the statically imported bundled asset only (Req 2).
 * Kept separate from model-catalog.ts so the bundled read stays a pure,
 * I/O-free module.
 */
export const getEffectiveSelectableModelIds = async (
  provider: AiProvider,
): Promise<string[]> => {
  const refreshed = await prisma.mastrarefreshedmodelcatalogs.getSingleton();

  if (refreshed != null) {
    // "Strictly newer" so a tie (and an unparsable bundled timestamp, whose
    // getTime() is NaN and never compares greater) resolves to the refreshed
    // snapshot.
    const bundledIsNewer =
      BUNDLED_CATALOG_GENERATED_AT.getTime() > refreshed.fetchedAt.getTime();

    if (!bundledIsNewer) {
      // Same controlled widening as the bundled read: the stored value is a
      // validated ModelCatalog, indexable only by catalog-backed providers, so
      // a catalog-less provider (e.g. 'azure-openai') falls back to [] (Req 3.1).
      const models: Record<string, readonly string[]> = refreshed.models;
      return [...(models[provider] ?? [])];
    }
  }

  return getSelectableModelIds(provider);
};
