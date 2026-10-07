import {
  buildModelCatalog,
  MODELS_DEV_URL,
  type ModelCatalog,
} from './build-model-catalog';

/**
 * Default bound for the models.dev fetch. Every ingest path must be bounded:
 * the runtime refresh so an admin request / cron tick cannot pin a worker on
 * a hung upstream, and the release-pre-step ingest script so a slow-drip
 * response fails the step (absorbed by its continue-on-error) instead of
 * stalling the release job toward GitHub's 360-minute kill — a job-level kill
 * that continue-on-error cannot rescue.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/**
 * Fetch models.dev and build the validated catalog — the single acquisition
 * pipeline shared by BOTH ingest paths (the release-pre-step script
 * bin/vendor-model-catalog.ts and the runtime refresh service), so the fetch
 * behavior (fixed URL, timeout bound, HTTP error handling) cannot drift
 * between them (Req 9.1, 9.7).
 *
 * Throws on timeout, network failure, HTTP error status, models.dev schema
 * drift, or an empty target provider; each caller decides what a failure
 * means (non-zero exit preserving the committed asset vs a 500 preserving
 * the last-good snapshot).
 */
export const fetchModelsDevCatalog = async (options?: {
  timeoutMs?: number;
}): Promise<ModelCatalog> => {
  const res = await fetch(MODELS_DEV_URL, {
    signal: AbortSignal.timeout(options?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch the model catalog: ${res.status} ${res.statusText} for ${MODELS_DEV_URL}`,
    );
  }
  const apiJson: unknown = await res.json();

  return buildModelCatalog(apiJson);
};
