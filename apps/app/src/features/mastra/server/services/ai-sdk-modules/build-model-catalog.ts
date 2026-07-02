import { z } from 'zod';

import {
  CATALOG_PROVIDERS,
  type CatalogProvider,
  isSelectableModel,
  type ModelsDevModel,
} from './chat-model-filter';

// ─── models.dev source (single source of truth for every ingest path) ────────
// Consumed by BOTH catalog acquisition paths — the release-pre-step ingest
// script (bin/vendor-model-catalog.ts) and the opt-in runtime refresh service
// (refresh-model-catalog.ts, Req 9). The URL is a build-time constant: callers
// can never point the ingest at another host (Req 9.7).

export const MODELS_DEV_URL = 'https://models.dev/api.json';
export const MODELS_DEV_SOURCE_ATTRIBUTION = `${MODELS_DEV_URL} (MIT)`;

// ─── Output contract ─────────────────────────────────────────────────────────

/** provider → generation-time-filtered selectable model ids (bare ids, sorted). */
export type ModelCatalog = Record<CatalogProvider, string[]>;

/** The committed file shape: header (attribution / timestamp) separated from data. */
export interface ModelCatalogFile {
  readonly _source: string;
  readonly _generatedAt: string;
  readonly models: ModelCatalog;
}

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
 * Transform a raw models.dev api.json object into the catalog's `models` map.
 * Pure and deterministic: no network, no clock (callers add timestamps), same
 * input ⇒ same output. Shared by the ingest script and the runtime refresh
 * service so both paths apply the identical filter and sanity checks (Req 9.1).
 *
 * For each target provider it boundary-validates the shape, applies the
 * generation-time chat+tool filter (`isSelectableModel`), collects bare ids,
 * sorts them, and asserts the result is non-empty (Issue 2: never ship a silent
 * empty catalog). Any invalid shape or empty provider throws.
 */
export const buildModelCatalog = (
  apiJson: unknown,
  providers: readonly CatalogProvider[] = CATALOG_PROVIDERS,
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
