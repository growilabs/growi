import { AI_PROVIDERS, type AiProvider } from '../interfaces/ai-provider';

// Separator between the provider and the modelId in a closed selector trigger
// ("provider · modelId"). U+00B7 MIDDLE DOT. Naming the selected model with its
// provider keeps the same modelId under different providers distinguishable when
// the menu is closed (Req 4.2). Shared so the admin default-model selector and the
// chat model selector render the label identically.
const MODEL_LABEL_SEPARATOR = ' · ';

/** A provider slot paired with the items it owns, in the input's original order. */
export interface ProviderModelGroup<T> {
  readonly provider: AiProvider;
  readonly entries: readonly T[];
}

/**
 * Group items by their owning provider in the fixed `AI_PROVIDERS` slot order,
 * preserving each item's order within its group and dropping providers that own no
 * item (Req 4.1/4.2). Generic over the item shape via a `getProvider` accessor so
 * both selectors (whose item shapes differ — the admin one wraps rows with their
 * flat-array index) share ONE grouping rule and cannot drift.
 */
export const groupModelsByProvider = <T>(
  items: readonly T[],
  getProvider: (item: T) => AiProvider,
): ProviderModelGroup<T>[] =>
  AI_PROVIDERS.map((provider) => ({
    provider,
    entries: items.filter((item) => getProvider(item) === provider),
  })).filter((group) => group.entries.length > 0);

/**
 * The closed-trigger label for a selected model: "provider · modelId" (Req 4.2).
 */
export const formatModelLabel = (
  provider: AiProvider,
  modelId: string,
): string => `${provider}${MODEL_LABEL_SEPARATOR}${modelId}`;
