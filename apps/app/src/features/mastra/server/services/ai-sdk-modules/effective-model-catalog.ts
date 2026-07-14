import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type { AiProvider } from '../../../interfaces/ai-provider';
import {
  type ModelCatalogEntry,
  pickSelectableModels,
} from './build-model-catalog';
import {
  BUNDLED_CATALOG_GENERATED_AT,
  getSelectableModels,
} from './model-catalog';

const logger = loggerFactory(
  'growi:features:mastra:services:effective-model-catalog',
);

/**
 * A synchronous per-provider accessor over the resolved EFFECTIVE catalog.
 * Catalog-less providers (e.g. 'azure-openai') fail soft to [] (Req 3.1).
 */
type EffectiveModelPicker = (provider: AiProvider) => ModelCatalogEntry[];

/**
 * Resolve the EFFECTIVE catalog ONCE and return a synchronous per-provider
 * accessor over it. The effective catalog is the NEWER of the persisted
 * refreshed catalog (Req 9) and the bundled committed asset (Req 9.5):
 *
 * - no refreshed snapshot → bundled (the offline default)
 * - refreshed snapshot present → the refreshed one, UNLESS the image now
 *   bundles a strictly newer catalog generation than the one that was current
 *   when the refresh ran (an image update shipped a fresher catalog) — then
 *   the bundled one wins until the next successful refresh
 *
 * The comparison uses bundled `_generatedAt` values on BOTH sides (the current
 * asset's vs the one stamped on the snapshot at refresh time), so server clock
 * skew cannot shadow a just-persisted refresh behind the bundled catalog. The
 * full clock-domain rationale lives on the field it reads:
 * IRefreshedModelCatalog.supersededBundledGeneratedAt.
 *
 * The read itself performs no external communication — it consults local
 * storage (MongoDB) and the statically imported bundled asset only (Req 2).
 * Kept separate from model-catalog.ts so the bundled read stays a pure,
 * I/O-free module.
 *
 * Returning a picker (rather than one provider's models) lets a multi-provider
 * caller — e.g. buildModelDisplayNameResolver over the whole allow-list — read
 * the persisted singleton a SINGLE time and then resolve every provider from
 * the one in-memory result, instead of one DB read per provider.
 */
export const getEffectiveModelPicker =
  async (): Promise<EffectiveModelPicker> => {
    try {
      const refreshed =
        await prisma.mastrarefreshedmodelcatalogs.getSingleton();

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
          // Shared accessor (same as the bundled read): catalog-less providers
          // (e.g. 'azure-openai') fail soft to [] (Req 3.1).
          //
          // Defense in depth: getSingleton validates the snapshot on read, but if
          // a corrupt value ever slips through (e.g. a non-iterable provider
          // entry), the per-provider pick must degrade to the bundled catalog,
          // never throw into the caller (a 500 on every read). The guard lives in
          // the returned accessor because the pick — and thus the throw — happens
          // when a provider is looked up, not when the singleton is read.
          return (provider) => {
            try {
              return pickSelectableModels(refreshed.models, provider);
            } catch (err) {
              logger.warn(
                'The persisted model-catalog snapshot is unusable; serving the bundled catalog instead',
                err,
              );
              return getSelectableModels(provider);
            }
          };
        }
      }
    } catch (err) {
      // The refreshed branch must never take the endpoint down: any persistence
      // failure (a document a different code version wrote that Prisma cannot
      // map, a transient MongoDB error) degrades to the bundled catalog — the
      // static import below cannot fail — instead of turning every
      // available-models read into a 500.
      logger.warn(
        'Failed to read the refreshed model catalog; serving the bundled catalog instead',
        err,
      );
    }

    // Bundled fallback: getSelectableModels IS the (provider) → entries accessor.
    return getSelectableModels;
  };

/**
 * Resolve the selectable models (id + display name) for a SINGLE provider from
 * the EFFECTIVE catalog. Thin wrapper over {@link getEffectiveModelPicker} for
 * the one-provider call sites (e.g. the available-models endpoint). See that
 * function for the newer-wins / fail-soft / offline rationale.
 */
export const getEffectiveSelectableModels = async (
  provider: AiProvider,
): Promise<ModelCatalogEntry[]> => {
  const pick = await getEffectiveModelPicker();
  return pick(provider);
};
