/**
 * Drop the query string from an `Activity.endpoint` before it is indexed.
 *
 * `endpoint` is `req.originalUrl`. Only activities recorded through add-activity.ts
 * have the credential-bearing `access_token` query parameter redacted before they
 * reach MongoDB; routes that call createActivity directly with `req.originalUrl`
 * (e.g. search, page export) still store it raw. The index is only used for path
 * aggregation and wildcard search, where the query string is noise anyway, so it
 * is dropped wholesale here instead of keeping a denylist of secret-bearing
 * parameter names in sync.
 *
 * As a result the indexed value is path-only and deliberately diverges from the
 * `endpoint` stored in MongoDB: a search term that carries a query string will
 * not match.
 */
export const sanitizeEndpointForIndex = (endpoint: string): string =>
  endpoint.split('?')[0];
