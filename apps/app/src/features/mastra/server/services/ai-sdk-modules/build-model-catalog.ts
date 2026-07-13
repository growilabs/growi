import { z } from 'zod';

import type { AiProvider } from '../../../interfaces/ai-provider';
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

/**
 * One selectable model in the catalog: its bare id (the AI SDK model id, also the
 * models.dev map key) paired with the official display `name` from models.dev.
 *
 * The name is captured HERE, at the same moment as the id, from the same
 * models.dev snapshot — so the two can never drift (models.dev removes/renames
 * models over time, and a separate later lookup could miss an id it once had).
 * When models.dev carries no name for an entry, the id is stored as the name so
 * the display always has a value (fallback resolved at generation time, not on
 * every read).
 */
// A `type` (not `interface`) on purpose: the persisted snapshot is spread into a
// Prisma `Json` (InputJsonValue) column, and only a type alias is assignable to
// Json's `{ [k: string]: ... }` index signature — an interface is not (it can be
// augmented, so TS withholds the implicit index signature).
export type ModelCatalogEntry = {
  readonly id: string;
  readonly name: string;
};

/** provider → generation-time-filtered selectable models (sorted by id). */
export type ModelCatalog = Record<CatalogProvider, ModelCatalogEntry[]>;

/** The committed file shape: header (attribution / timestamp) separated from data. */
export interface ModelCatalogFile {
  readonly _source: string;
  readonly _generatedAt: string;
  readonly models: ModelCatalog;
}

// ─── Persisted-snapshot schema (read-side validation) ────────────────────────
// The runtime refresh persists a ModelCatalog as an untyped Json field
// (mastra_refreshed_model_catalog). Reads validate against this schema instead
// of trusting a cast: the stored value is only as trustworthy as the code
// version that WROTE it, so a version-skewed (rolling upgrade sharing one
// MongoDB) or hand-edited document must degrade to the bundled catalog, not
// crash every available-models read. Keys are restricted to the current
// CATALOG_PROVIDERS: a document written by a different version with a
// different provider set fails validation and is ignored (conservative).

export const persistedModelCatalogSchema = z.record(
  z.enum(CATALOG_PROVIDERS),
  z.array(z.object({ id: z.string(), name: z.string() })),
);

// ─── Catalog accessors (shared by every read/report site) ───────────────────

/**
 * Index a catalog by ANY AiProvider with the catalog-less fail-soft (Req 3.1):
 * ModelCatalog is keyed only by the catalog-backed providers, so a general
 * AiProvider (which includes 'azure-openai') cannot index it directly — widen
 * to the string-keyed record shape and fall back to []. The result is spread
 * into a fresh mutable array so callers can never mutate the shared imported
 * asset or the stored snapshot. Single source for BOTH read paths (the bundled
 * model-catalog.ts and the refreshed effective-model-catalog.ts).
 */
export const pickSelectableModels = (
  models: ModelCatalog,
  provider: AiProvider,
): ModelCatalogEntry[] => {
  const widened: Record<string, readonly ModelCatalogEntry[]> = models;
  return [...(widened[provider] ?? [])];
};

/** provider → number of selectable models (refresh response + log summaries). */
export const deriveProviderCounts = (
  models: ModelCatalog,
): Record<string, number> => {
  return Object.fromEntries(
    Object.entries(models).map(([provider, entries]) => [
      provider,
      entries.length,
    ]),
  );
};

/** `openai=41, anthropic=24, ...` — the log-line form of deriveProviderCounts. */
export const formatProviderCounts = (
  counts: Record<string, number>,
): string => {
  return Object.entries(counts)
    .map(([provider, count]) => `${provider}=${count}`)
    .join(', ');
};

// ─── Boundary schema (fail-loud on drift, passthrough elsewhere) ─────────────
// Validate the two fields the filter reads (`tool_call`, `modalities.output`) on
// EVERY entry of a target provider, and pass every OTHER field/provider through
// untouched. models.dev populates these two on every entry (non-chat models such
// as embeddings/TTS carry `tool_call: false` / a non-text output modality, not a
// missing field), so a missing or mistyped field means models.dev has drifted
// from the shape we depend on. That must fail loudly, not silently ship a
// degraded catalog: a partial drift (some entries restructured) would otherwise
// drop real chat models with no signal, and the effective read would serve the
// shrunken list. On such a throw the last-good catalog is preserved (the release
// ingest keeps the committed artifact; a runtime refresh keeps the persisted/
// bundled one — Req 9.4), so failing loud costs freshness, never availability.

const modelEntrySchema = z.looseObject({
  tool_call: z.boolean(),
  modalities: z.looseObject({
    output: z.array(z.string()),
  }),
  // Official display name. Optional (not part of the drift contract): models.dev
  // populates it on every current entry, but a missing name is not a schema
  // change we must fail on — it degrades to the id (see the transform). Only
  // `tool_call`/`modalities.output` are treated as required drift signals above.
  name: z.string().optional(),
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
 * empty catalog). Any drift — a missing/mistyped `tool_call` or
 * `modalities.output` on any entry, a non-map `models`, a missing target
 * provider, or a provider left empty after filtering — throws (fail-loud: a
 * models.dev shape change must surface, not degrade the catalog silently).
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

    // Boundary validation: throws on schema drift (`models` not a map, or a
    // missing/mistyped `tool_call`/`modalities.output` on any entry). See the
    // schema note above for why a missing field is treated as drift, not data.
    const parsed = providerSchema.parse(rawProvider);

    // The bare model id is the map key (mirrored on `entry.id` in real data);
    // use the validated key set so we don't depend on the optional `id` field.
    // `parsed.models` entries carry the two authoritative fields validated
    // above; pass each to the shared filter (single source of truth). The
    // display `name` is captured here from the same entry (id fallback when
    // models.dev omits it) so id and name come from one snapshot and never drift.
    const selectableEntries = Object.entries(parsed.models)
      .filter(([, entry]) => isSelectableModel(entry as ModelsDevModel))
      .map(([id, entry]) => ({ id, name: entry.name ?? id }));

    // Sort by id code point (locale-independent) to keep the emitted file
    // deterministic across environments. A bare `localeCompare()` collates per the
    // runner's default ICU locale and would reorder ids such as `gpt-5.1-chat-latest`
    // under e.g. a Czech locale, breaking the same-input⇒same-output guarantee.
    const sorted = selectableEntries.toSorted((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );

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
