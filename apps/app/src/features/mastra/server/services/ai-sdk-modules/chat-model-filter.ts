// The catalog-provider set is declared once in the client-safe interfaces layer
// (single source of truth) and re-exported here so the vendoring script and the
// route keep importing it from this module unchanged.
export { CATALOG_PROVIDERS } from '~/features/mastra/interfaces/catalog-providers';

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
