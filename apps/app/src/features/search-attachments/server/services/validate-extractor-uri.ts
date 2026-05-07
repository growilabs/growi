/**
 * Cloud metadata IP literals to block (exact match, not CIDR).
 * Blocking these prevents SSRF attacks targeting cloud instance metadata services.
 *
 * Note: Node.js URL parser preserves brackets in url.hostname for IPv6 addresses
 * (e.g. `http://[fd00:ec2::254]` → hostname is `[fd00:ec2::254]`), so both the
 * bare and bracketed forms are included for IPv6 entries.
 */
const BLOCKED_METADATA_IPS = new Set([
  '169.254.169.254', // AWS/GCP/Azure link-local metadata
  'fd00:ec2::254', // AWS IPv6 metadata (bare, in case of direct string match)
  '[fd00:ec2::254]', // AWS IPv6 metadata (bracketed form as returned by url.hostname)
  '100.100.100.200', // Alibaba Cloud metadata
  '192.0.0.192', // GCP internal metadata
]);

export type ExtractorUriValidationResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_url' | 'invalid_scheme' | 'metadata_ip' };

/**
 * Validates an extractor URI for safe use.
 *
 * Rejects:
 * - Non-http(s) schemes (prevents file://, ftp://, data:, javascript:, etc.)
 * - Cloud metadata IP literals (prevents SSRF targeting instance metadata APIs)
 * - Unparseable URIs
 *
 * Accepts:
 * - http and https schemes
 * - Any hostname including k8s DNS (.cluster.local, .svc), docker-compose service names
 * - Loopback addresses (127.x.x.x, ::1, localhost)
 * - RFC1918 private ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
 * - Public hostnames
 *
 * This is a pure function with no side effects.
 */
export const validateExtractorUri = (
  uri: string,
): ExtractorUriValidationResult => {
  let parsed: URL;

  try {
    parsed = new URL(uri);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  // Only allow http and https schemes
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'invalid_scheme' };
  }

  // Check hostname against blocked metadata IP literals.
  // Note: Node.js URL parser preserves brackets in hostname for IPv6 (e.g. [fd00:ec2::254]).
  if (BLOCKED_METADATA_IPS.has(parsed.hostname)) {
    return { ok: false, reason: 'metadata_ip' };
  }

  return { ok: true };
};
