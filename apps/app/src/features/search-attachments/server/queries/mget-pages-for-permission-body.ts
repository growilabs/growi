/**
 * Builds the parameters of an Elasticsearch `mget` request against the page
 * index that fetches only lightweight page fields (never the page body).
 *
 * The fields are passed as the `_source_includes` request parameter. A
 * top-level `_source` object in the request body is rejected by Elasticsearch
 * with a `parsing_exception`.
 *
 * An `mget` result is NOT an authorization decision: `found: true` only means
 * the page is indexed. Viewer access is decided by `searchAccessiblePages`.
 */

/** Field names as stored in the page index (see the page index mappings). */
const PAGE_SOURCE_INCLUDES = [
  'path',
  'grant',
  'granted_users',
  'granted_groups',
  'updated_at',
] as const;

export type MgetPagesParams = {
  ids: string[];
  _source_includes: string[];
};

export function mgetPagesForPermissionBody(pageIds: string[]): MgetPagesParams {
  return {
    ids: [...pageIds],
    _source_includes: [...PAGE_SOURCE_INCLUDES],
  };
}
