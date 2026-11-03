import { BlockList, isIP } from 'node:net';

/**
 * Cloud instance metadata endpoints (SSRF targets). Checked on the parsed
 * address, so every spelling the URL parser accepts — IPv4-mapped IPv6,
 * decimal / hex IPv4, expanded IPv6 — matches the same entry.
 */
const BLOCKED_METADATA_ADDRESSES = (() => {
  const list = new BlockList();
  // link-local: AWS / GCP / Azure / OpenStack metadata live here
  list.addSubnet('169.254.0.0', 16, 'ipv4');
  list.addAddress('100.100.100.200', 'ipv4'); // Alibaba Cloud
  list.addAddress('192.0.0.192', 'ipv4'); // GCP internal metadata
  list.addAddress('fd00:ec2::254', 'ipv6'); // AWS IPv6
  return list;
})();

const BLOCKED_METADATA_HOSTNAMES = new Set(['metadata.google.internal']);

export type ExtractorUriValidationResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_url' | 'invalid_scheme' | 'metadata_ip' };

/**
 * Whether an IP address (as written in a URL or returned by DNS) is a cloud
 * metadata endpoint. Not an IP address: false.
 */
export const isCloudMetadataAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) return BLOCKED_METADATA_ADDRESSES.check(address, 'ipv4');
  if (family === 6) return BLOCKED_METADATA_ADDRESSES.check(address, 'ipv6');
  return false;
};

const isBlockedHost = (hostname: string): boolean => {
  // url.hostname keeps the brackets of an IPv6 literal
  const host = hostname.replace(/^\[(.*)\]$/, '$1');
  if (isIP(host) !== 0) return isCloudMetadataAddress(host);
  return BLOCKED_METADATA_HOSTNAMES.has(host.toLowerCase().replace(/\.$/, ''));
};

/**
 * Validates an extractor URI for safe use.
 *
 * Rejects:
 * - Non-http(s) schemes (prevents file://, ftp://, data:, javascript:, etc.)
 * - Cloud metadata addresses and host names (prevents SSRF targeting
 *   instance metadata APIs)
 * - Unparseable URIs
 *
 * Accepts:
 * - http and https schemes
 * - Any hostname including k8s DNS (.cluster.local, .svc), docker-compose service names
 * - Loopback addresses (127.x.x.x, ::1, localhost)
 * - RFC1918 private ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
 * - Public hostnames
 *
 * Host names are not resolved, so a name that resolves to a metadata address
 * is not caught here. This is a pure function with no side effects.
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

  if (isBlockedHost(parsed.hostname)) {
    return { ok: false, reason: 'metadata_ip' };
  }

  return { ok: true };
};
