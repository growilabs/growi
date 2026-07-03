import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import {
  MODELS_DEV_SOURCE_ATTRIBUTION,
  type ModelCatalog,
} from './build-model-catalog';
import { fetchModelsDevCatalog } from './fetch-model-catalog';
import { BUNDLED_CATALOG_GENERATED_AT } from './model-catalog';

const logger = loggerFactory(
  'growi:features:mastra:services:refresh-model-catalog',
);

export interface RefreshModelCatalogResult {
  models: ModelCatalog;
  fetchedAt: Date;
}

/**
 * Refresh the model catalog from models.dev at runtime (Req 9): fetch the
 * fixed built-in URL, apply the SAME filter/validation as the bundled asset
 * (buildModelCatalog), and persist the snapshot as the singleton
 * RefreshedModelCatalog document so it survives restarts and is shared across
 * app instances.
 *
 * This is the ONLY runtime path that performs external communication, and it
 * runs solely when explicitly triggered (admin request, opt-in startup
 * refresh, or opt-in cron — Req 9.6). Any failure (network, HTTP status,
 * schema drift, empty provider) throws BEFORE anything is persisted, so the
 * last-good catalog (a previous refresh, or the bundled asset) stays in effect
 * (Req 9.4).
 */
export const refreshModelCatalog =
  async (): Promise<RefreshModelCatalogResult> => {
    // Shared acquisition pipeline (fixed URL, bounded by a timeout): throws on
    // network/HTTP failure, schema drift, or any empty target provider —
    // nothing is persisted on failure (Req 9.4).
    const models = await fetchModelsDevCatalog();

    const fetchedAt = new Date();
    await prisma.mastrarefreshedmodelcatalogs.upsertSingleton({
      models,
      fetchedAt,
      // Stamp the bundled generation this snapshot supersedes: the newer-wins
      // read (Req 9.5) compares bundled _generatedAt values only, keeping both
      // operands in the vendoring machine's clock domain (server clock skew
      // must not shadow a successful refresh — see effective-model-catalog.ts).
      supersededBundledGeneratedAt: BUNDLED_CATALOG_GENERATED_AT,
      source: MODELS_DEV_SOURCE_ATTRIBUTION,
    });

    const counts = Object.entries(models)
      .map(([provider, ids]) => `${provider}=${ids.length}`)
      .join(', ');
    logger.info(`Refreshed the model catalog from models.dev (${counts})`);

    return { models, fetchedAt };
  };
