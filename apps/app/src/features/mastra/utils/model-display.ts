import {
  AI_PROVIDERS,
  type AiProvider,
  getProviderLabel,
} from '../interfaces/ai-provider';

// Separator between the provider and the model's display name in a closed
// selector trigger ("Provider · name"). U+00B7 MIDDLE DOT. Naming the selected
// model with its provider keeps a same-named model under different providers
// distinguishable when the menu is closed (Req 4.2). Shared so the admin
// default-model selector and the chat model selector render the label identically.
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
 * The closed-trigger label for a selected model: "Provider · name" (Req 4.2).
 * The provider is rendered as its official display name (`getProviderLabel`),
 * never the raw provider key; `displayName` is the model's official display name
 * (already id-fallback-resolved by the caller — the bare id for catalog-less
 * providers / free-text / removed ids).
 */
export const formatModelLabel = (
  provider: AiProvider,
  displayName: string,
): string =>
  `${getProviderLabel(provider)}${MODEL_LABEL_SEPARATOR}${displayName}`;
