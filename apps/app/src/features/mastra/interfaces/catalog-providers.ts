import type { AiProvider } from './ai-provider';

/**
 * Providers whose model catalog is vendored from models.dev and therefore drive
 * selection-only registration. Declared here in the client-safe interfaces layer
 * as the SINGLE source of truth so both the ingest-time filter
 * (`chat-model-filter`, which re-exports this) and the client UI read the same
 * set — no duplicated provider list to drift.
 *
 * Declared as data (not computed by excluding azure-openai from AI_PROVIDERS):
 * azure-openai is absent from models.dev because its model IDs are
 * operator-defined deployment names and cannot be enumerated, so it stays
 * free-input.
 */
export const CATALOG_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
] as const satisfies readonly AiProvider[];

/**
 * Whether the given provider is catalog-backed (selection-only). Lets the client
 * predict the modelId control type before the async list resolves, so a
 * configured catalog provider renders the `<select>` immediately without a
 * text→select flash on open. The server response stays authoritative: an empty
 * list still falls back to free-text.
 */
export const providerHasCatalog = (provider: AiProvider | ''): boolean =>
  provider !== '' &&
  (CATALOG_PROVIDERS as readonly string[]).includes(provider);
