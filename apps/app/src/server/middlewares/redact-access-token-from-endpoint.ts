// Query parameter names that must never be persisted verbatim in Activity.endpoint.
// GROWI accepts `access_token` as a query parameter (see certify-origin.ts), so the
// raw req.originalUrl can carry a plaintext credential.
const SENSITIVE_QUERY_PARAMS = ['access_token'];

/**
 * Redact sensitive query parameter values from a request URL before it is persisted
 * (Activity.endpoint stores req.originalUrl verbatim otherwise). Other query
 * parameters are preserved, since the endpoint is used for forensic audit purposes
 * beyond just the path.
 */
export const redactAccessTokenFromEndpoint = (originalUrl: string): string => {
  const separatorIndex = originalUrl.indexOf('?');
  if (separatorIndex === -1) return originalUrl;

  const pathname = originalUrl.slice(0, separatorIndex);
  const queryString = originalUrl.slice(separatorIndex + 1);
  const params = new URLSearchParams(queryString);

  let redacted = false;
  for (const key of SENSITIVE_QUERY_PARAMS) {
    if (params.has(key)) {
      params.set(key, '[REDACTED]');
      redacted = true;
    }
  }
  if (!redacted) return originalUrl;

  return `${pathname}?${params.toString()}`;
};
