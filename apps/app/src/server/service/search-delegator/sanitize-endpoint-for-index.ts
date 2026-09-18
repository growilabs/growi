/**
 * Drop the query string from an `Activity.endpoint` before it is indexed.
 *
 * `endpoint` is `req.originalUrl`, and GROWI accepts `access_token` as a query
 * parameter, so the raw value can carry a plaintext credential that would end up
 * searchable — and returnable via terms aggregation — in the auditlog index.
 * The index is only used for path aggregation and wildcard search, where the
 * query string is noise anyway, so it is dropped wholesale instead of keeping a
 * denylist of secret-bearing parameter names in sync.
 *
 * As a result the indexed value is path-only and deliberately diverges from the
 * `endpoint` stored in MongoDB: a search term that carries a query string will
 * not match.
 */
export const sanitizeEndpointForIndex = (endpoint: string): string =>
  endpoint.split('?')[0];
