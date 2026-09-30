// Query parameter names that must never be persisted verbatim in Activity.endpoint.
// GROWI accepts `access_token` as a query parameter (see certify-origin.ts), so the
// raw req.originalUrl can carry a plaintext credential.
const SENSITIVE_QUERY_PARAMS = ['access_token'];

const REDACTED_VALUE = '[REDACTED]';

// Compare the decoded key, since Express's query parser decodes keys too
// (`access%5Ftoken=x` is read as `access_token`).
const isSensitiveKey = (rawKey: string): boolean => {
  try {
    return SENSITIVE_QUERY_PARAMS.includes(
      decodeURIComponent(rawKey.replaceAll('+', ' ')),
    );
  } catch {
    return false;
  }
};

/**
 * Redact sensitive query parameter values from a request URL before it is persisted
 * (Activity.endpoint stores req.originalUrl verbatim otherwise). Only the sensitive
 * values are replaced; every other part of the URL is kept byte-for-byte, since the
 * endpoint is used for forensic audit purposes beyond just the path.
 */
export const redactAccessTokenFromEndpoint = (originalUrl: string): string => {
  const separatorIndex = originalUrl.indexOf('?');
  if (separatorIndex === -1) return originalUrl;

  const pathname = originalUrl.slice(0, separatorIndex);
  const segments = originalUrl.slice(separatorIndex + 1).split('&');

  const redactedSegments = segments.map((segment) => {
    const rawKey = segment.split('=')[0];
    return isSensitiveKey(rawKey) ? `${rawKey}=${REDACTED_VALUE}` : segment;
  });

  return `${pathname}?${redactedSegments.join('&')}`;
};
