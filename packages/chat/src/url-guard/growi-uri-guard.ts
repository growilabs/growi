// Pure judgement of a GROWI URI declared during pairing (`pairing/submit`),
// so that a holder of a single registration code cannot turn the proxy into a
// probe of whatever the proxy can reach (Requirement 9.2, 13.1). See design.md
// "④ で申告された URL を検証する（踏み台にされないため）" and the table in
// "この検証を**どちらが持つか**" for the split of duties: this package judges
// the three argument-only conditions, and `chat-integration-proxy` owns name
// resolution, connecting to the exact address that was judged, refusing
// redirects and capping the response wait.
//
// This module resolves no names and opens no sockets -- the caller passes the
// already-resolved addresses in. Allowed Dependencies forbids `node:dns` and
// network access here.

export type UriVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'scheme' | 'port' | 'private-address' | 'malformed';
    };

/**
 * Compare a hostname written in a URI with a hostname written by the operator.
 * Both sides go through the same normalisation: the brackets around an IPv6
 * literal are removed, letters are lowered, and one trailing dot (the explicit
 * root label of a fully qualified name) is dropped.
 */
const normalizeHostname = (hostname: string): string => {
  const withoutBrackets =
    hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
  const lowered = withoutBrackets.toLowerCase();
  return lowered.endsWith('.') ? lowered.slice(0, -1) : lowered;
};

/**
 * Parse dotted-quad IPv4. Leading zeros are refused rather than accepted,
 * because different resolvers read `010.0.0.1` as decimal 10 or as octal 8 --
 * a form that is read two ways must not be judged by this function at all.
 * An unparsed address is treated as private by the caller of this helper.
 */
const parseIpv4 = (address: string): ReadonlyArray<number> | undefined => {
  const parts = address.split('.');
  if (parts.length !== 4) {
    return undefined;
  }

  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return undefined;
    }
    if (part.length > 1 && part.startsWith('0')) {
      return undefined;
    }
    const value = Number(part);
    if (value > 255) {
      return undefined;
    }
    bytes.push(value);
  }
  return bytes;
};

/**
 * Parse IPv6 into its 16 bytes, including the `::` shorthand and a trailing
 * IPv4 part (`::ffff:169.254.169.254`). A zone id (`fe80::1%eth0`) is refused,
 * which the caller reads as private -- the only addresses that carry one are
 * link-local anyway.
 */
const parseIpv6 = (address: string): ReadonlyArray<number> | undefined => {
  if (!address.includes(':') || address.includes('%')) {
    return undefined;
  }

  const doubleColonCount = address.split('::').length - 1;
  if (doubleColonCount > 1) {
    return undefined;
  }

  const [head, tail] =
    doubleColonCount === 1 ? address.split('::') : [address, undefined];

  const toBytes = (section: string): number[] | undefined => {
    if (section === '') {
      return [];
    }

    const groups = section.split(':');
    const bytes: number[] = [];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      // Only the very last group may be written as a dotted-quad IPv4 part.
      if (group.includes('.')) {
        if (i !== groups.length - 1) {
          return undefined;
        }
        const ipv4 = parseIpv4(group);
        if (ipv4 == null) {
          return undefined;
        }
        bytes.push(...ipv4);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(group)) {
        return undefined;
      }
      const value = Number.parseInt(group, 16);
      bytes.push(value >> 8, value & 0xff);
    }
    return bytes;
  };

  const headBytes = toBytes(head);
  const tailBytes = tail == null ? [] : toBytes(tail);
  if (headBytes == null || tailBytes == null) {
    return undefined;
  }

  const filled = headBytes.length + tailBytes.length;
  if (doubleColonCount === 0) {
    return filled === 16 ? headBytes : undefined;
  }
  if (filled > 15) {
    // `::` has to stand for at least one omitted group.
    return undefined;
  }
  return [...headBytes, ...new Array(16 - filled).fill(0), ...tailBytes];
};

/** Ranges named by design.md's table, plus the two forms that reach the same hosts. */
const isPrivateIpv4 = (bytes: ReadonlyArray<number>): boolean => {
  const [a, b] = bytes;

  // RFC 1918
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // Link-local -- the cloud metadata endpoint 169.254.169.254 lives here
  if (a === 169 && b === 254) return true;
  // Loopback
  if (a === 127) return true;
  // "This network": 0.0.0.0 reaches loopback on common stacks, so it is a
  // spelling of 127.0.0.1 rather than a separate policy decision.
  if (a === 0) return true;

  // --- Beyond design.md's list. Kept because the task says to err toward
  // refusing, and because an operator who really does place GROWI here can
  // still declare it in `allowList`. ---
  // Carrier-grade NAT (RFC 6598): reachable inside a carrier network, never
  // from the public internet.
  if (a === 100 && b >= 64 && b <= 127) return true;

  return false;
};

const isPrivateIpv6 = (bytes: ReadonlyArray<number>): boolean => {
  const isFirstTenBytesZero = bytes.slice(0, 10).every((byte) => byte === 0);
  if (isFirstTenBytesZero) {
    // ::ffff:a.b.c.d -- an IPv4-mapped address reaches exactly the IPv4 host it
    // spells out, so judging the plain forms only would leave a second spelling
    // of 169.254.169.254 open.
    if (bytes[10] === 0xff && bytes[11] === 0xff) {
      return isPrivateIpv4(bytes.slice(12));
    }
    if (bytes[10] === 0 && bytes[11] === 0) {
      // :: (unspecified, reaches loopback) and ::1 (loopback), plus the
      // deprecated IPv4-compatible ::a.b.c.d form.
      const last4 = bytes.slice(12);
      if (last4.every((byte) => byte === 0)) return true;
      if (last4[0] === 0 && last4[1] === 0 && last4[2] === 0) return true;
      return isPrivateIpv4(last4);
    }
  }

  // Unique-local fc00::/7
  if ((bytes[0] & 0xfe) === 0xfc) return true;

  // --- Beyond design.md's list, same reasoning as the IPv4 block above. ---
  // Link-local fe80::/10 -- the IPv6 counterpart of 169.254.0.0/16.
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;
  // Site-local fec0::/10 -- deprecated, but still configured on some networks.
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true;

  return false;
};

/** An address this function cannot read is treated as private (fail closed). */
const isPrivateAddress = (address: string): boolean => {
  const ipv4 = parseIpv4(address);
  if (ipv4 != null) {
    return isPrivateIpv4(ipv4);
  }

  const ipv6 = parseIpv6(address);
  if (ipv6 != null) {
    return isPrivateIpv6(ipv6);
  }

  return true;
};

/** The caller passes in the resolved addresses. This package does not resolve names. */
export const judgeGrowiUri = (
  uri: string,
  resolvedAddresses: ReadonlyArray<string>,
  /**
   * For a custom proxy to explicitly declare closed-network destinations.
   * Matching is against the HOSTNAME of `uri`, NOT `resolvedAddresses`
   * (matching by address would let permission silently move to a different
   * host just because DNS resolution changed).
   * A matched entry passes scheme, port AND private-address-range checks
   * TOGETHER: a closed-network GROWI is normally plain http on a non-default
   * port at an RFC 1918 address, so exempting only the address range would
   * still refuse every Requirement 13 deployment. The exemption stays inside
   * http/https -- what Requirement 13 needs is the plain-http closed-network
   * form, and `file:` / `gopher:` / `ws:` are refused even for an allowlisted
   * hostname.
   *
   * When the host of `uri` is written as an address instead of a name, the
   * caller passes that same address in `resolvedAddresses`: this function does
   * not classify the host itself.
   */
  allowList?: ReadonlyArray<string>,
): UriVerdict => {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (hostname === '') {
    // `file:///etc/passwd` parses but names no host.
    return { ok: false, reason: 'malformed' };
  }

  // The allowlist is consulted before anything else, because it exempts all
  // three conditions at once -- including the case where an internal-only name
  // resolves to nothing from where the caller runs.
  const isAllowListed = (allowList ?? []).some(
    (entry) => normalizeHostname(entry) === hostname,
  );
  // The exemption is bounded to http/https: the form Requirement 13 needs is
  // plain http, and lifting the scheme condition altogether would let anyone
  // who knows one allowlisted hostname hand `file:` or `gopher:` to the proxy.
  if (
    isAllowListed &&
    (parsed.protocol === 'http:' || parsed.protocol === 'https:')
  ) {
    return { ok: true };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'scheme' };
  }

  // WHATWG URL drops a port that is the default for the scheme, so '' and
  // '443' both mean the default here. Both are spelled out so the check does
  // not depend on the scheme check above having run first.
  if (parsed.port !== '' && parsed.port !== '443') {
    return { ok: false, reason: 'port' };
  }

  // No resolved address means nothing shows the destination is public.
  if (resolvedAddresses.length === 0) {
    return { ok: false, reason: 'private-address' };
  }
  // Every address has to be public: the caller may connect to any of them.
  if (resolvedAddresses.some(isPrivateAddress)) {
    return { ok: false, reason: 'private-address' };
  }

  return { ok: true };
};
