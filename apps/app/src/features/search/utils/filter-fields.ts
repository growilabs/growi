/**
 * Single source of truth for the search filter vocabulary, derived by both the
 * client serializer (`client/utils/search-query.ts`) and the server tokenizer
 * (`server/service/search.ts`) so the two grammars cannot drift apart. Kept
 * dependency-free (no React, no server/DB imports) so both bundles can import it.
 * It defines only the field/operator vocabulary — each side owns its own parser.
 */

/** The filter fields the search UI owns; each maps to one inline query operator. */
export type SearchFilterState = {
  authors: string[];
  editors: string[];
  groups: string[];
  tags: string[];
};

export type SearchFilterField = keyof SearchFilterState;

/**
 * Ordered `[field, operatorPrefix]` table. Order is fixed so the client
 * serializes deterministically (stable URLs/snapshots); the server ignores it.
 * `prefix:` is intentionally absent — the server recognizes it, but the UI does
 * not own it, so it is not shared here.
 */
export const FILTER_FIELDS = [
  ['authors', 'author:'],
  ['editors', 'editor:'],
  ['groups', 'group:'],
  ['tags', 'tag:'],
] as const satisfies ReadonlyArray<readonly [SearchFilterField, string]>;

// All UI-owned operator prefixes, in canonical order. No explicit type annotation:
// `.map` infers the literal element union (`'author:' | ...`), which a `string[]`
// annotation would widen away, so consumers deriving a type from these stay exact.
export const SEARCH_FILTER_PREFIXES = FILTER_FIELDS.map(([, prefix]) => prefix);
