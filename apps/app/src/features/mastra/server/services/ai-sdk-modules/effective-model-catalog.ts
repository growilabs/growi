import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type { AiProvider } from '../../../interfaces/ai-provider';
import {
  type ModelCatalog,
  type ModelCatalogEntry,
  pickSelectableModels,
} from './build-model-catalog';
import {
  BUNDLED_CATALOG_GENERATED_AT,
  BUNDLED_CATALOG_MODELS,
  getSelectableModels,
} from './model-catalog';

const logger = loggerFactory(
  'growi:features:mastra:services:effective-model-catalog',
);

type EffectiveModelPicker = (provider: AiProvider) => ModelCatalogEntry[];

export type EffectiveCatalog = {
  readonly source: 'bundled' | 'refreshed';
  /** When the content was fetched from models.dev (refreshed: fetchedAt, bundled: _generatedAt). */
  readonly contentFetchedAt: Date;
  readonly models: ModelCatalog;
};

const bundledCatalog = (): EffectiveCatalog => ({
  source: 'bundled',
  contentFetchedAt: BUNDLED_CATALOG_GENERATED_AT,
  models: BUNDLED_CATALOG_MODELS,
});

/**
 * Resolve the EFFECTIVE catalog in a single read: the NEWER of the persisted
 * refreshed catalog (Req 9) and the bundled committed asset (Req 9.5). This is
 * the only place the two are compared. Never throws.
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
 */
export const resolveEffectiveCatalog = async (): Promise<EffectiveCatalog> => {
  try {
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
        return {
          source: 'refreshed',
          contentFetchedAt: refreshed.fetchedAt,
          models: refreshed.models,
        };
      }
    }
  } catch (err) {
    // Any persistence failure (a document a different code version wrote that
    // Prisma cannot map, a transient MongoDB error) degrades to the bundled
    // catalog instead of turning every read into a 500.
    logger.warn(
      'Failed to read the refreshed model catalog; serving the bundled catalog instead',
      err,
    );
  }

  return bundledCatalog();
};

/**
 * Look up one entry (with its pricing, when known) in a resolved catalog.
 * Catalog-less providers (e.g. 'azure-openai') yield undefined (Req 3.1).
 */
export const findCatalogEntry = (
  catalog: EffectiveCatalog,
  provider: AiProvider,
  modelId: string,
): ModelCatalogEntry | undefined =>
  pickSelectableModels(catalog.models, provider).find((m) => m.id === modelId);

/**
 * Resolve the effective catalog ONCE and return a synchronous per-provider
 * accessor over it. Catalog-less providers fail soft to [] (Req 3.1).
 *
 * Returning a picker (rather than one provider's models) lets a multi-provider
 * caller — e.g. buildModelDisplayNameResolver over the whole allow-list — read
 * the persisted singleton a SINGLE time instead of once per provider.
 */
export const getEffectiveModelPicker =
  async (): Promise<EffectiveModelPicker> => {
    const catalog = await resolveEffectiveCatalog();
    if (catalog.source === 'bundled') {
      return (provider) => pickSelectableModels(catalog.models, provider);
    }

    // Defense in depth: getSingleton validates the snapshot on read, but if a
    // corrupt value ever slips through (e.g. a non-iterable provider entry),
    // the per-provider pick must degrade to the bundled catalog, never throw
    // into the caller. The guard lives here because the throw happens when a
    // provider is looked up, not when the singleton is read.
    return (provider) => {
      try {
        return pickSelectableModels(catalog.models, provider);
      } catch (err) {
        logger.warn(
          'The persisted model-catalog snapshot is unusable; serving the bundled catalog instead',
          err,
        );
        return getSelectableModels(provider);
      }
    };
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
