/**
 * Drop the query string from an `Activity.endpoint` before it is indexed.
 *
 * `endpoint` is `req.originalUrl` (the credential-bearing `access_token` query
 * parameter, if present, is already redacted before it reaches MongoDB — see
 * add-activity.ts's use of redactAccessTokenFromEndpoint). The index is only used
 * for path aggregation and wildcard search, where the query string is noise
 * anyway, so it is dropped wholesale here too instead of keeping a denylist of
 * secret-bearing parameter names in sync.
 *
 * As a result the indexed value is path-only and deliberately diverges from the
 * `endpoint` stored in MongoDB: a search term that carries a query string will
 * not match.
 */
export const sanitizeEndpointForIndex = (endpoint: string): string =>
  endpoint.split('?')[0];
