/**
 * Pure function that builds the request body for an Elasticsearch mget call
 * against the page index, fetching only the fields needed to evaluate page
 * access permissions.
 *
 * The returned object is a body-only mget payload; the caller is responsible
 * for specifying the index when invoking the ES client.
 */

/**
 * Fields required for permission evaluation and display.
 * Restricted to the minimum set to avoid over-fetching large page bodies.
 */
const PERMISSION_SOURCE_INCLUDES = [
  '_id',
  'grant',
  'grantedUsers',
  'grantedGroups',
  'creator',
  'path',
  'title',
  'updatedAt',
] as const;

/**
 * Build the body for an Elasticsearch mget request that fetches permission-relevant
 * fields for a set of page IDs.
 *
 * @param pageIds - Array of page document IDs to fetch
 * @returns ES mget request body with _source restricted to permission fields
 */
export function mgetPagesForPermissionBody(
  pageIds: string[],
): Record<string, unknown> {
  return {
    ids: pageIds,
    _source: {
      includes: [...PERMISSION_SOURCE_INCLUDES],
    },
  };
}
