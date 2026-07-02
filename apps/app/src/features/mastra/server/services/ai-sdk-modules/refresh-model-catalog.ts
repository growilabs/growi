import loggerFactory from '~/utils/logger';

import { RefreshedModelCatalog } from '../../models/refreshed-model-catalog';
import {
  buildModelCatalog,
  MODELS_DEV_SOURCE_ATTRIBUTION,
  MODELS_DEV_URL,
  type ModelCatalog,
} from './build-model-catalog';

const logger = loggerFactory(
  'growi:features:mastra:services:refresh-model-catalog',
);

const FETCH_TIMEOUT_MS = 30_000;

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
    const res = await fetch(MODELS_DEV_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(
        `Failed to fetch the model catalog: ${res.status} ${res.statusText} for ${MODELS_DEV_URL}`,
      );
    }
    const apiJson: unknown = await res.json();

    // Throws on schema drift or any empty target provider — nothing is
    // persisted on failure (Req 9.4).
    const models = buildModelCatalog(apiJson);

    const fetchedAt = new Date();
    await RefreshedModelCatalog.upsertSingleton({
      models,
      fetchedAt,
      source: MODELS_DEV_SOURCE_ATTRIBUTION,
    });

    const counts = Object.entries(models)
      .map(([provider, ids]) => `${provider}=${ids.length}`)
      .join(', ');
    logger.info(`Refreshed the model catalog from models.dev (${counts})`);

    return { models, fetchedAt };
  };
