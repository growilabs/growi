/**
 * Ingest step (release pre-step, NOT build, NOT runtime):
 *   fetch models.dev api.json → boundary-validate → generation-time filter
 *   (chat + tool-call models only) → write a committed, deterministic JSON asset.
 *
 * Runtime and the build pipeline NEVER fetch: they read the committed
 * `model-catalog-data.json` only. Only this script performs network I/O, and
 * only when run explicitly via `pnpm vendor:models` (developer / release
 * pre-step). See design.md "Build / Release → vendor-model-catalog".
 *
 * cross-platform: uses only Node's built-in `fetch` and `node:fs` — no curl/rm.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import {
  CATALOG_PROVIDERS,
  isSelectableModel,
  type ModelsDevModel,
} from '../src/features/mastra/server/services/ai-sdk-modules/chat-model-filter.ts';

// ─── Output contract (this script's own types) ──────────────────────────────
// Kept local: runtime code reads the emitted JSON via a typed `import ... with
// { type: 'json' }` (task 3.1), it does NOT import these types, and no runtime
// `src/` module imports from `bin/`.

/** provider → generation-time-filtered selectable model ids (bare ids, sorted). */
type ModelCatalog = Record<(typeof CATALOG_PROVIDERS)[number], string[]>;

/** The committed file shape: header (attribution / timestamp) separated from data. */
interface ModelCatalogFile {
  readonly _source: string;
  readonly _generatedAt: string;
  readonly models: ModelCatalog;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MODELS_DEV_URL = 'https://models.dev/api.json';
const SOURCE_ATTRIBUTION = `${MODELS_DEV_URL} (MIT)`;

const OUTPUT_PATH = resolve(
  import.meta.dirname,
  '../src/features/mastra/server/services/ai-sdk-modules/model-catalog-data.json',
);

// ─── Boundary schema (tolerant / passthrough) ────────────────────────────────
// Validate ONLY the fields the filter reads (`tool_call`, `modalities.output`);
// pass every other field/provider through so upstream additions never break the
// ingest. A shape violation (missing/mistyped required field, `models` not a
// map) throws — models.dev schema drift must fail loudly, not ship a bad catalog.

const modelEntrySchema = z.looseObject({
  tool_call: z.boolean(),
  modalities: z.looseObject({
    output: z.array(z.string()),
  }),
});

const providerSchema = z.looseObject({
  models: z.record(z.string(), modelEntrySchema),
});

// ─── Pure transform (network-free, deterministic, unit-tested) ───────────────

/**
 * Transform a raw models.dev api.json object into the committed catalog's
 * `models` map. Pure and deterministic: no network, no clock (the wrapper adds
 * `_generatedAt`), same input ⇒ same output.
 *
 * For each target provider it boundary-validates the shape, applies the
 * generation-time chat+tool filter (`isSelectableModel`), collects bare ids,
 * sorts them, and asserts the result is non-empty (Issue 2: never ship a silent
 * empty catalog). Any invalid shape or empty provider throws.
 */
export const buildModelCatalog = (
  apiJson: unknown,
  providers: readonly (typeof CATALOG_PROVIDERS)[number][] = CATALOG_PROVIDERS,
): ModelCatalog => {
  const root = z.record(z.string(), z.unknown()).parse(apiJson);

  const emptyProviders: string[] = [];
  const models = {} as ModelCatalog;

  for (const provider of providers) {
    const rawProvider = root[provider];
    if (rawProvider == null) {
      throw new Error(
        `models.dev api.json is missing the target provider "${provider}"`,
      );
    }

    // Boundary validation: throws on schema drift (wrong `models` shape,
    // missing/mistyped `tool_call` or `modalities.output`).
    const parsed = providerSchema.parse(rawProvider);

    // The bare model id is the map key (mirrored on `entry.id` in real data);
    // use the validated key set so we don't depend on the optional `id` field.
    // `parsed.models` entries carry the two authoritative fields validated
    // above; pass each to the shared filter (single source of truth).
    const selectableIds = Object.entries(parsed.models)
      .filter(([, entry]) => isSelectableModel(entry as ModelsDevModel))
      .map(([id]) => id);

    // Sort by code point (locale-independent) to keep the emitted file
    // deterministic across environments. A bare `localeCompare()` collates per the
    // runner's default ICU locale and would reorder ids such as `gpt-5.1-chat-latest`
    // under e.g. a Czech locale, breaking the same-input⇒same-output guarantee.
    const sorted = selectableIds.toSorted();

    if (sorted.length === 0) {
      emptyProviders.push(provider);
    }

    models[provider] = sorted;
  }

  if (emptyProviders.length > 0) {
    const counts = providers
      .map((p) => `${p}=${models[p]?.length ?? 0}`)
      .join(', ');
    throw new Error(
      `No selectable (tool_call && text-output) models found for provider(s): ${emptyProviders.join(
        ', ',
      )}. Selectable counts: ${counts}. Refusing to write an empty catalog.`,
    );
  }

  return models;
};

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
    _source: SOURCE_ATTRIBUTION,
    _generatedAt: new Date().toISOString(),
    models,
  };

  // Deterministic serialization: 2-space indent + trailing newline. Provider
  // keys are emitted in CATALOG_PROVIDERS order (buildModelCatalog iterates it).
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');

  const counts = CATALOG_PROVIDERS.map((p) => `${p}=${models[p].length}`).join(
    ', ',
  );
  // biome-ignore lint/suspicious/noConsole: ingest script — stdout summary is expected
  console.log(`[vendor:models] wrote ${OUTPUT_PATH} (${counts})`);
};

if (isEntryPoint()) {
  await main();
}
