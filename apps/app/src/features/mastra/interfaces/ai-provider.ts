// Server-only module: the single source of truth for the supported LLM provider
// set and its per-provider metadata. Do NOT add client imports here.

/**
 * Per-provider metadata.
 *
 * `enumerable` — whether the provider's model catalog can be enumerated via
 * models.dev, which drives selection-only model registration. azure-openai is
 * `false`: its model IDs are operator-defined deployment names that cannot be
 * enumerated, so it stays free-input.
 *
 * Declaring the flag alongside the provider (rather than in a separate list)
 * makes adding a provider a single, unforgettable decision: `CATALOG_PROVIDERS`
 * (chat-model-filter.ts) is derived from this map, so it can never silently
 * drift out of sync with the provider set.
 */
interface AiProviderMeta {
  readonly enumerable: boolean;
}

export const AI_PROVIDER_DEFS = {
  openai: { enumerable: true },
  anthropic: { enumerable: true },
  google: { enumerable: true },
  'azure-openai': { enumerable: false },
} as const satisfies Record<string, AiProviderMeta>;

export type AiProvider = keyof typeof AI_PROVIDER_DEFS;

// Object.keys preserves insertion order for string keys, so runtime order
// matches the declaration order in AI_PROVIDER_DEFS.
export const AI_PROVIDERS: readonly AiProvider[] = Object.keys(
  AI_PROVIDER_DEFS,
) as AiProvider[];

export const isAiProvider = (value: unknown): value is AiProvider =>
  typeof value === 'string' &&
  (AI_PROVIDERS as readonly string[]).includes(value);
