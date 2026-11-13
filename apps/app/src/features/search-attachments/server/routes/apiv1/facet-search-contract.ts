import type {
  IFacetedSearchResult,
  IPageWithSearchMeta,
  SearchFacet,
} from '~/interfaces/search';

import type { IPrimarySearchResult } from '../../services/attachment-search-result-aggregator';

/** Bounds the attachment and permission queries one facet search can issue. */
export const FACET_SEARCH_MAX_LIMIT = 200;
/** The default page size of /_api/search (ApiPaginate), kept for facet searches. */
const FACET_SEARCH_DEFAULT_LIMIT = 50;

const FACETS: readonly SearchFacet[] = ['all', 'pages', 'attachments'];
const RESOLVE_MODES = ['primary', 'full'] as const;
export type ResolveMode = (typeof RESOLVE_MODES)[number];

export type FacetSearchParams =
  | { ok: true; facet: SearchFacet | null; resolve: ResolveMode }
  | { ok: false; message: string };

const pickOne = <T extends string>(
  raw: unknown,
  allowed: readonly T[],
): T | undefined =>
  typeof raw === 'string' && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : undefined;

/**
 * Reads the optional `facet` / `resolve` query parameters of `/_api/search`.
 * Without `facet` the request is a plain page search and `resolve` is
 * ignored, so existing callers keep their behaviour. Error messages are fixed
 * strings and never echo the input.
 */
export const parseFacetSearchParams = (
  query: Record<string, unknown>,
): FacetSearchParams => {
  if (query.facet === undefined) {
    return { ok: true, facet: null, resolve: 'primary' };
  }
  const facet = pickOne(query.facet, FACETS);
  if (facet == null) {
    return {
      ok: false,
      message: 'The param "facet" must be one of all, pages, attachments.',
    };
  }
  if (query.resolve === undefined) {
    return { ok: true, facet, resolve: 'primary' };
  }
  const resolve = pickOne(query.resolve, RESOLVE_MODES);
  if (resolve == null) {
    return {
      ok: false,
      message: 'The param "resolve" must be one of primary, full.',
    };
  }
  return { ok: true, facet, resolve };
};

export type FacetPagination =
  | { ok: true; from: number; size: number }
  | { ok: false; message: string };

const DIGITS = /^\d+$/;

/** undefined: absent or empty (the default applies); null: not a decimal integer */
const readNonNegativeInteger = (raw: unknown): number | null | undefined => {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string' || !DIGITS.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
};

/**
 * Reads `limit` / `offset` of a facet search from the raw query, so that
 * values parseInt would silently truncate (`1.5`, `1e9`) or turn into NaN
 * are refused rather than reaching the attachment search. Absent or empty
 * values take the same defaults as the page search. Error messages are fixed
 * strings and never echo the input.
 */
export const parseFacetPagination = (
  query: Record<string, unknown>,
): FacetPagination => {
  const size = readNonNegativeInteger(query.limit);
  if (
    size === null ||
    (size !== undefined && (size < 1 || size > FACET_SEARCH_MAX_LIMIT))
  ) {
    return {
      ok: false,
      message: `The param "limit" must be an integer between 1 and ${FACET_SEARCH_MAX_LIMIT} when "facet" is all or attachments.`,
    };
  }
  const from = readNonNegativeInteger(query.offset);
  if (from === null) {
    return {
      ok: false,
      message:
        'The param "offset" must be a non-negative integer when "facet" is all or attachments.',
    };
  }
  return {
    ok: true,
    from: from ?? 0,
    size: size ?? FACET_SEARCH_DEFAULT_LIMIT,
  };
};

export const toFacetedSearchResult = (
  facet: SearchFacet,
  result: IPrimarySearchResult,
): IFacetedSearchResult => {
  const data: IPageWithSearchMeta[] = result.items;
  const { total, primaryResultIncomplete, nextCursor } = result.meta;
  return {
    data,
    meta: {
      facet,
      total,
      hitsCount: data.length,
      ...(primaryResultIncomplete != null ? { primaryResultIncomplete } : {}),
      ...(nextCursor != null ? { nextCursor } : {}),
    },
  };
};
