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
 * - refreshed snapshot present → the refreshed one, UNLESS the image now
 *   bundles a strictly newer catalog generation than the one that was current
 *   when the refresh ran (an image update shipped a fresher catalog) — then
 *   the bundled one wins until the next successful refresh
 *
 * The comparison uses bundled `_generatedAt` values on BOTH sides (the current
 * asset's vs the one stamped on the snapshot at refresh time), so both
 * operands come from the vendoring machine's clock. Comparing the
 * server-clock `fetchedAt` against the CI-clock `_generatedAt` would let a
 * lagging server clock silently shadow a just-persisted refresh behind the
 * bundled catalog while the admin sees a success toast. A successful refresh
 * is by construction at least as fresh as the asset bundled at that moment,
 * so "did the image change to a newer generation since" is the only question
 * the read needs to answer.
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
    // "Strictly newer" so a tie — the normal "refreshed on the currently
    // deployed image" case — and an unparsable timestamp (NaN never compares
    // greater) resolve to the refreshed snapshot. An image ROLLBACK (bundled
    // generation older than the superseded one) also keeps the refreshed
    // snapshot, which is correct: it holds live-fetched data.
    const bundledIsNewer =
      BUNDLED_CATALOG_GENERATED_AT.getTime() >
      refreshed.supersededBundledGeneratedAt.getTime();

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
