/**
 * Drop the query string from an `Activity.endpoint` before it is indexed.
 *
 * `endpoint` is `req.originalUrl`. The activity model redacts `access_token` on
 * save, but rows stored before that redaction existed may still carry it raw. The
 * index is only used for path aggregation and wildcard search, where the query
 * string is noise anyway, so it is dropped wholesale here instead of keeping a
 * denylist of secret-bearing parameter names in sync.
 *
 * As a result the indexed value is path-only and deliberately diverges from the
 * `endpoint` stored in MongoDB. The endpoint suggestion handler passes its query
 * through this function too, so a query string in the search term is dropped
 * the same way.
 */
export const sanitizeEndpointForIndex = (endpoint: string): string =>
  endpoint.split('?')[0];
