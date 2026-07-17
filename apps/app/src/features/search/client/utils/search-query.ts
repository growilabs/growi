/**
 * Client-side search query model.
 *
 * The translation layer between the search-filter UI's structured state and the
 * flat inline query string the server's `parseQueryString`
 * (server/service/search.ts) consumes. These are pure functions: no React, no
 * network, no URL-encoding (that stays in the URL layer). `buildSearchQuery`
 * serializes structured state into the `?q=` string; `parseSearchQuery` recovers
 * it. The grammar deliberately mirrors the server tokenizer so the two never
 * disagree.
 *
 * Round-trip contract:
 *
 *   parseSearchQuery(buildSearchQuery(keyword, filters))
 *     deep-equals { keyword, filters }
 *
 * This holds when the keyword is normalized (trimmed, single-spaced) and free of
 * operator tokens, and the filter values are non-empty and free of double-quotes
 * (which `buildSearchQuery` strips, since the grammar cannot escape them, so a
 * value like `a"b` round-trips to its quote-free form `ab`). A keyword that itself
 * contains operator syntax (`author:foo`, a quoted phrase, …) is intentionally
 * NOT round-trip stable: on parse it is reinterpreted as a filter, since a
 * hand-typed operator is meant to hydrate the corresponding chip.
 */

import {
  FILTER_FIELDS,
  SEARCH_FILTER_PREFIXES,
  type SearchFilterField,
  type SearchFilterState,
} from '../../utils/filter-fields';

// Re-exported so existing consumers can keep importing the type from here.
export type { SearchFilterState };

export type ParsedSearchQuery = {
  keyword: string;
  filters: SearchFilterState;
};

const PREFIX_ALTERNATION = SEARCH_FILTER_PREFIXES.join('|');

// Reverse lookup (operator prefix -> state field) for parsing.
const FIELD_BY_PREFIX: Record<string, SearchFilterField> = Object.fromEntries(
  FILTER_FIELDS.map(([field, prefix]) => [prefix, field]),
);

// Matches one operator with a quoted (space-bearing) or bare value. Run as a
// single left-to-right replace, it keeps a field's values in source order even
// when quoted and bare are mixed. The leading `(^|\s)` excludes negated
// operators (`-group:x`), so those pass through into the keyword untouched.
const FILTER_REGEXP = new RegExp(
  `(^|\\s)(${PREFIX_ALTERNATION})("[^"]+"|\\S+)`,
  'g',
);

export const createEmptyFilterState = (): SearchFilterState => ({
  authors: [],
  editors: [],
  groups: [],
  tags: [],
});

/** True when no filter field holds any value. */
export const isFilterStateEmpty = (filters: SearchFilterState): boolean =>
  filters.authors.length === 0 &&
  filters.editors.length === 0 &&
  filters.groups.length === 0 &&
  filters.tags.length === 0;

const normalizeKeyword = (keyword: string): string =>
  keyword.trim().replace(/\s+/g, ' ');

const quoteIfNeeded = (value: string): string =>
  /\s/.test(value) ? `"${value}"` : value;

/**
 * Serialize free-text keyword + structured filters into an inline query string.
 * Empty/whitespace-only filter values are skipped so a bare, valueless operator
 * (`author:`) is never emitted.
 */
export const buildSearchQuery = (
  keyword: string,
  filters: SearchFilterState,
): string => {
  const parts: string[] = [];

  const normalizedKeyword = normalizeKeyword(keyword);
  if (normalizedKeyword !== '') {
    parts.push(normalizedKeyword);
  }

  for (const [field, prefix] of FILTER_FIELDS) {
    for (const value of filters[field]) {
      // Strip embedded double-quotes: the grammar has no way to escape them, and
      // the server strips quotes too, so emitting one would corrupt the query
      // (the value could be truncated or partly reinterpreted as free text).
      const cleaned = value.replace(/"/g, '').trim();
      if (cleaned === '') {
        continue;
      }
      parts.push(`${prefix}${quoteIfNeeded(cleaned)}`);
    }
  }

  return parts.join(' ');
};

/**
 * Parse an inline query string back into keyword + structured filters. Anything
 * the UI does not own — phrases, `prefix:`, negations such as `-author:x` — is
 * kept in `keyword` (whitespace-normalized to match the server) rather than
 * dropped, so no filter information is lost on round-trip.
 */
export const parseSearchQuery = (queryString: string): ParsedSearchQuery => {
  const filters = createEmptyFilterState();

  const remainder = queryString.replace(
    FILTER_REGEXP,
    (_match, lead: string, prefix: string, rawValue: string) => {
      // Strip quotes: unwraps a quoted value, no-op for a bare one, and cleans a
      // stray quote from a malformed `author:"x` (matching the server).
      const value = rawValue.replace(/"/g, '');
      // A quotes-only operator (`author:""`, `author:"`) carries no value; drop
      // it instead of committing a blank chip and running an empty-value filter.
      if (value !== '') {
        filters[FIELD_BY_PREFIX[prefix]].push(value);
      }
      // Preserve the leading whitespace so neighbouring tokens stay separated.
      return lead;
    },
  );

  return { keyword: normalizeKeyword(remainder), filters };
};
