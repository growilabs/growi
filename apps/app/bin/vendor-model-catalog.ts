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
 * NOTE: run via `pnpm vendor:models` (which registers bin/dev-esm-resolver.mjs)
 * — the imported src modules use the app's path-alias/extensionless import
 * convention, which plain `node bin/...` cannot resolve.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildModelCatalog,
  MODELS_DEV_SOURCE_ATTRIBUTION,
  MODELS_DEV_URL,
  type ModelCatalog,
  type ModelCatalogFile,
} from '../src/features/mastra/server/services/ai-sdk-modules/build-model-catalog.ts';

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
  let apiJson: unknown;
  try {
    const res = await fetch(MODELS_DEV_URL);
    if (!res.ok) {
      // biome-ignore lint/suspicious/noConsole: ingest script — stderr diagnostics are expected
      console.error(
        `[vendor:models] fetch failed: ${res.status} ${res.statusText} for ${MODELS_DEV_URL}. Existing catalog preserved (not overwritten).`,
      );
      process.exit(1);
    }
    apiJson = await res.json();
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: ingest script — stderr diagnostics are expected
    console.error(
      `[vendor:models] network error fetching ${MODELS_DEV_URL}. Existing catalog preserved (not overwritten).`,
      err,
    );
    process.exit(1);
    return;
  }

  let models: ModelCatalog;
  try {
    // buildModelCatalog throws on schema drift or any empty target provider,
    // BEFORE any write — so a bad upstream can never overwrite a good catalog.
    models = buildModelCatalog(apiJson);
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: ingest script — stderr diagnostics are expected
    console.error(
      '[vendor:models] validation/sanity check failed. Existing catalog preserved (not overwritten).',
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

  const counts = Object.entries(models)
    .map(([p, ids]) => `${p}=${ids.length}`)
    .join(', ');
  // biome-ignore lint/suspicious/noConsole: ingest script — stdout summary is expected
  console.log(`[vendor:models] wrote ${OUTPUT_PATH} (${counts})`);
};

if (isEntryPoint()) {
  await main();
}
