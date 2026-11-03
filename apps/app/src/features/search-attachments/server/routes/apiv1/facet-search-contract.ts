import type {
  IFacetedSearchResult,
  IPageWithSearchMeta,
  SearchFacet,
} from '~/interfaces/search';

import type { IPrimarySearchResult } from '../../services/attachment-search-result-aggregator';

/** Bounds the attachment and permission queries one facet search can issue. */
export const FACET_SEARCH_MAX_LIMIT = 200;

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
