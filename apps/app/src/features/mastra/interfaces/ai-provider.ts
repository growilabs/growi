// Client-safe, dependency-free module: the single source of truth for the
// supported LLM provider set and its per-provider metadata. It has NO imports and
// is imported (as VALUES — AI_PROVIDERS / mapProviders / isAiProvider) from both the
// Express server and the Next.js client bundle (e.g. AiSettings, ChatSidebar,
// DefaultModelSelector, ProviderTabs). Keep it dependency-free so it stays importable
// from both: do NOT add server-only imports (config, logger, etc.) here.

/**
 * Per-provider metadata.
 *
 * `enumerable` — whether the provider's model catalog can be enumerated via
 * models.dev, which drives selection-only model registration. azure-openai is
 * `false`: its model IDs are operator-defined deployment names that cannot be
 * enumerated, so it stays free-input.
 *
 * `label` — the provider's official display name, shown wherever a provider is
 * named in the UI (admin tabs/selectors, chat model selector). The raw provider
 * KEY (`openai`, `azure-openai`) is an internal identifier and is never shown to
 * users. Kept in this dependency-free map (not sourced from models.dev) so it
 * covers every provider — including `azure-openai`, which has no models.dev
 * catalog — and stays available on both server and client without a fetch.
 *
 * Declaring the flags alongside the provider (rather than in separate lists)
 * makes adding a provider a single, unforgettable decision: `CATALOG_PROVIDERS`
 * (chat-model-filter.ts) is derived from this map, so it can never silently
 * drift out of sync with the provider set.
 */
interface AiProviderMeta {
  readonly enumerable: boolean;
  readonly label: string;
}

export const AI_PROVIDER_DEFS = {
  openai: { enumerable: true, label: 'OpenAI' },
  anthropic: { enumerable: true, label: 'Anthropic' },
  google: { enumerable: true, label: 'Google' },
  'azure-openai': { enumerable: false, label: 'Azure OpenAI' },
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

/**
 * The provider's official display name (`AI_PROVIDER_DEFS[provider].label`).
 * The single accessor every UI site uses to render a provider name, so the raw
 * provider key never leaks to users and the four labels stay defined in one place.
 */
export const getProviderLabel = (provider: AiProvider): string =>
  AI_PROVIDER_DEFS[provider].label;

/**
 * Build a fixed-slot Record over ALL supported providers by mapping each one.
 * `Object.fromEntries` widens to `{ [k: string]: T }`; the single `as` here narrows
 * it back to the fixed-slot Record — sound because EVERY AI_PROVIDERS entry is
 * mapped, so no key is missing. This is the ONE place that cast lives, so consumers
 * (form seed, PUT body, admin GET, tab flags) get a typed Record without repeating it.
 */
export const mapProviders = <T>(
  fn: (provider: AiProvider) => T,
): Record<AiProvider, T> =>
  Object.fromEntries(
    AI_PROVIDERS.map((p): [AiProvider, T] => [p, fn(p)]),
  ) as Record<AiProvider, T>;
