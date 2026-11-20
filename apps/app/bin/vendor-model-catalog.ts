/**
 * Ingest step (release pre-step, NOT build, NOT runtime):
 *   fetch models.dev api.json → boundary-validate → generation-time filter
 *   (chat + tool-call models only) → write a committed, deterministic JSON asset.
 *
 * The build pipeline NEVER fetches: it reads the committed
 * `model-catalog-data.json` only. This script performs network I/O only when
 * run explicitly via `pnpm vendor:models` (developer / release pre-step); the
 * runtime counterpart is the opt-in refresh service
 * (src/features/mastra/server/services/ai-sdk-modules/refresh-model-catalog.ts),
 * which shares the same transform. See design.md "Build / Release →
 * vendor-model-catalog".
 *
 * cross-platform: uses only Node's built-in `fetch` and `node:fs` — no curl/rm.
 *
 * NOTE: run via `pnpm vendor:models` (which registers bin/runtime/dev-esm-resolver.mjs)
 * — the imported src modules use the app's path-alias/extensionless import
 * convention, which plain `node bin/...` cannot resolve.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  deriveProviderCounts,
  formatProviderCounts,
  MODELS_DEV_SOURCE_ATTRIBUTION,
  MODELS_DEV_URL,
  type ModelCatalog,
  type ModelCatalogFile,
} from '../src/features/mastra/server/services/ai-sdk-modules/build-model-catalog.ts';
import { fetchModelsDevCatalog } from '../src/features/mastra/server/services/ai-sdk-modules/fetch-model-catalog.ts';

const OUTPUT_PATH = resolve(
  import.meta.dirname,
  '../resource/model-catalog-data.json',
);

// ─── Thin I/O wrapper (only runs when executed as the entry point) ───────────

const isEntryPoint = (): boolean => {
  const entry = process.argv[1];
  return (
    entry != null && resolve(entry) === resolve(import.meta.filename ?? '')
  );
};

export const main = async (): Promise<void> => {
  let models: ModelCatalog;
  try {
    // Shared acquisition pipeline (same module the runtime refresh uses):
    // fixed URL, bounded by a timeout so a hung/slow-drip upstream fails this
    // step instead of stalling the release job toward its 360-minute kill.
    // Throws on network/HTTP failure, schema drift, or any empty target
    // provider, BEFORE any write — a bad upstream can never overwrite a good
    // catalog.
    models = await fetchModelsDevCatalog();
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: ingest script — stderr diagnostics are expected
    console.error(
      `[vendor:models] fetch/validation failed for ${MODELS_DEV_URL}. Existing catalog preserved (not overwritten).`,
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
    return;
  }

  const file: ModelCatalogFile = {
    _source: MODELS_DEV_SOURCE_ATTRIBUTION,
    _generatedAt: new Date().toISOString(),
    models,
  };

  // Deterministic serialization: 2-space indent + trailing newline. Provider
  // keys are emitted in CATALOG_PROVIDERS order (buildModelCatalog iterates it).
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');

  const counts = formatProviderCounts(deriveProviderCounts(models));
  // biome-ignore lint/suspicious/noConsole: ingest script — stdout summary is expected
  console.log(`[vendor:models] wrote ${OUTPUT_PATH} (${counts})`);
};

if (isEntryPoint()) {
  await main();
}
