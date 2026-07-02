import {
  AI_PROVIDER_DEFS,
  AI_PROVIDERS,
  type AiProvider,
} from '~/features/mastra/interfaces/ai-provider';

/**
 * The subset of AiProvider whose model catalog is enumerable via models.dev
 * (metadata flag `enumerable: true`). Derived from AI_PROVIDER_DEFS at the type
 * level so it stays a precise literal union (used to key the vendored catalog)
 * and tracks the metadata automatically.
 */
export type CatalogProvider = {
  [K in AiProvider]: (typeof AI_PROVIDER_DEFS)[K]['enumerable'] extends true
    ? K
    : never;
}[AiProvider];

/**
 * Providers whose model catalog is present in models.dev and therefore drive
 * selection-only registration. Derived (not hand-listed) from AI_PROVIDER_DEFS:
 * the `enumerable` flag is the single source, so adding a provider is one
 * declaration there and this list can never drift out of sync. azure-openai is
 * `enumerable: false` (its model IDs are operator-defined deployment names that
 * cannot be enumerated), so it stays free-input.
 */
export const CATALOG_PROVIDERS: readonly CatalogProvider[] =
  AI_PROVIDERS.filter(
    (p): p is CatalogProvider => AI_PROVIDER_DEFS[p].enumerable,
  );

/**
 * A single models.dev catalog entry, narrowed to the only two authoritative
 * fields the chat/tool filter reads. models.dev entries carry many more fields;
 * structural typing lets the vendoring script pass wider validated objects.
 */
export interface ModelsDevModel {
  readonly tool_call: boolean;
  readonly modalities: { readonly output: readonly string[] };
}

/**
 * A model is selectable for GROWI chat iff it supports tool calls AND produces
 * text output. The judgment uses models.dev's authoritative metadata only
 * (tool_call flag + output modality); it never relies on name heuristics (6.2).
 * This excludes tool-incapable models and non-text modalities (embedding /
 * image / audio) that cannot serve the chat use case (6.1).
 */
export const isSelectableModel = (entry: ModelsDevModel): boolean =>
  entry.tool_call === true && entry.modalities.output.includes('text');
