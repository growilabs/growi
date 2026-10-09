import { describe, expect, it } from 'vitest';

import { judgeGrowiUri } from './growi-uri-guard.js';

// A public address used whenever the address itself is not what a test is about.
const PUBLIC = ['93.184.216.34'];

describe('judgeGrowiUri', () => {
  describe('malformed input', () => {
    it.each([
      ['not a url at all', 'not a url'],
      ['empty string', ''],
      ['scheme-relative reference', '//growi.example.com/'],
      ['path only', '/pairing'],
      ['https with no host', 'https://'],
    ])('rejects %s with reason malformed', (_label, uri) => {
      expect(judgeGrowiUri(uri, PUBLIC)).toEqual({
        ok: false,
        reason: 'malformed',
      });
    });

    it('rejects a URL whose host is empty even though it parses (file:)', () => {
      // `new URL('file:///etc/passwd')` parses, hostname is ''. A verdict of
      // ok here would let the caller try to fetch a local path.
      const verdict = judgeGrowiUri('file:///etc/passwd', PUBLIC);
      expect(verdict.ok).toBe(false);
    });
  });

  describe('scheme', () => {
    it('accepts https', () => {
      expect(judgeGrowiUri('https://growi.example.com/', PUBLIC)).toEqual({
        ok: true,
      });
    });

    it.each([
      'http://growi.example.com/',
      'ftp://growi.example.com/',
      'file://growi.example.com/etc/passwd',
      'gopher://growi.example.com/',
      'ws://growi.example.com/',
    ])('rejects %s with reason scheme', (uri) => {
      expect(judgeGrowiUri(uri, PUBLIC)).toEqual({
        ok: false,
        reason: 'scheme',
      });
    });
  });

  describe('port', () => {
    it('accepts the implicit default port', () => {
      expect(judgeGrowiUri('https://growi.example.com/', PUBLIC)).toEqual({
        ok: true,
      });
    });

    it('accepts an explicitly written 443', () => {
      expect(judgeGrowiUri('https://growi.example.com:443/', PUBLIC)).toEqual({
        ok: true,
      });
    });

    it.each([
      '8443',
      '3000',
      '80',
      '22',
      '9200',
    ])('rejects port %s with reason port', (port) => {
      expect(
        judgeGrowiUri(`https://growi.example.com:${port}/`, PUBLIC),
      ).toEqual({ ok: false, reason: 'port' });
    });
  });

  describe('resolved address ranges', () => {
    const judgeAddress = (address: string) =>
      judgeGrowiUri('https://growi.example.com/', [address]);

    const privateAddresses: ReadonlyArray<[string, string]> = [
      // RFC 1918 -- both edges of each range
      ['10.0.0.0', 'RFC1918 10/8 lower edge'],
      ['10.255.255.255', 'RFC1918 10/8 upper edge'],
      ['172.16.0.0', 'RFC1918 172.16/12 lower edge'],
      ['172.31.255.255', 'RFC1918 172.16/12 upper edge'],
      ['192.168.0.0', 'RFC1918 192.168/16 lower edge'],
      ['192.168.255.255', 'RFC1918 192.168/16 upper edge'],
      // Link-local -- the cloud metadata endpoint lives here
      ['169.254.0.0', 'link-local lower edge'],
      ['169.254.169.254', 'cloud metadata endpoint'],
      ['169.254.255.255', 'link-local upper edge'],
      // Loopback
      ['127.0.0.0', 'loopback lower edge'],
      ['127.0.0.1', 'loopback'],
      ['127.255.255.255', 'loopback upper edge'],
      // Unspecified / this-network
      ['0.0.0.0', 'unspecified IPv4 (reaches loopback on common stacks)'],
      ['0.255.255.255', '0/8 upper edge'],
      // Carrier-grade NAT
      ['100.64.0.0', 'CGNAT lower edge'],
      ['100.127.255.255', 'CGNAT upper edge'],
      // IPv6
      ['::1', 'IPv6 loopback'],
      ['::', 'IPv6 unspecified'],
      ['fc00::', 'unique-local lower edge'],
      ['fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'unique-local upper edge'],
      ['fe80::1', 'IPv6 link-local'],
      ['febf:ffff::1', 'IPv6 link-local upper edge'],
      ['fec0::1', 'IPv6 site-local (deprecated)'],
      // IPv4-mapped / IPv4-compatible IPv6 spellings of private addresses
      ['::ffff:169.254.169.254', 'IPv4-mapped metadata endpoint'],
      ['::ffff:a9fe:a9fe', 'IPv4-mapped metadata endpoint in hex form'],
      ['::ffff:10.0.0.5', 'IPv4-mapped RFC1918'],
      ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
      ['::10.0.0.5', 'IPv4-compatible RFC1918 (deprecated form)'],
    ];

    it.each(privateAddresses)('rejects %s (%s)', (address) => {
      expect(judgeAddress(address)).toEqual({
        ok: false,
        reason: 'private-address',
      });
    });

    const publicAddresses: ReadonlyArray<[string, string]> = [
      ['9.255.255.255', 'just below 10/8'],
      ['11.0.0.0', 'just above 10/8'],
      ['172.15.255.255', 'just below 172.16/12'],
      ['172.32.0.0', 'just above 172.16/12'],
      ['192.167.255.255', 'just below 192.168/16'],
      ['192.169.0.0', 'just above 192.168/16'],
      ['169.253.255.255', 'just below link-local'],
      ['169.255.0.0', 'just above link-local'],
      ['126.255.255.255', 'just below loopback'],
      ['128.0.0.0', 'just above loopback'],
      ['1.0.0.0', 'just above 0/8'],
      ['100.63.255.255', 'just below CGNAT'],
      ['100.128.0.0', 'just above CGNAT'],
      ['93.184.216.34', 'ordinary public address'],
      ['fbff:ffff::1', 'just below unique-local'],
      ['fe00::1', 'just above unique-local'],
      ['fe7f:ffff::1', 'just below IPv6 link-local'],
      ['ff00::1', 'above site-local'],
      ['2001:db8::1', 'ordinary global IPv6'],
      ['::ffff:93.184.216.34', 'IPv4-mapped public address'],
    ];

    it.each(publicAddresses)('accepts %s (%s)', (address) => {
      expect(judgeAddress(address)).toEqual({ ok: true });
    });

    it('rejects when any one of several resolved addresses is private', () => {
      // A name that resolves to both a public and an internal address must not
      // pass: the caller may connect to either one.
      expect(
        judgeGrowiUri('https://growi.example.com/', [
          '93.184.216.34',
          '10.0.0.5',
        ]),
      ).toEqual({ ok: false, reason: 'private-address' });
    });

    it('rejects when no address was resolved at all', () => {
      // Nothing proves the destination is public, so fail closed.
      expect(judgeGrowiUri('https://growi.example.com/', [])).toEqual({
        ok: false,
        reason: 'private-address',
      });
    });

    it.each([
      ['garbage', 'not-an-address'],
      ['out-of-range octet', '256.1.1.1'],
      ['octal-looking leading zeros', '010.0.0.1'],
      ['truncated', '10.0.0'],
      ['zone-id form', 'fe80::1%eth0'],
      ['two :: shorthands', 'fe80::1::2'],
      ['non-hex group', 'gggg::1'],
      ['too few IPv6 groups without ::', '1:2:3:4:5:6:7'],
      ['too many IPv6 groups', '1:2:3:4:5:6:7:8:9'],
      ['a :: that stands for nothing', '::1:2:3:4:5:6:7:8'],
      ['embedded IPv4 that is not the last group', '::ffff:1.2.3.4:5'],
      ['embedded IPv4 with an out-of-range octet', '::ffff:999.1.1.1'],
    ])('rejects an unparseable resolved address (%s)', (_label, address) => {
      expect(judgeAddress(address)).toEqual({
        ok: false,
        reason: 'private-address',
      });
    });
  });

  describe('allowList exempts all three conditions together', () => {
    // Requirement 13.1: the closed-network GROWI a custom proxy talks to is
    // normally plain http, on a non-default port, at an RFC 1918 address --
    // it fails ALL THREE checks at once.
    const closedNetworkUri = 'http://growi.internal:3000/';
    const closedNetworkAddresses = ['10.0.0.5'];

    it('rejects the closed-network destination when it is not allowlisted', () => {
      const verdict = judgeGrowiUri(closedNetworkUri, closedNetworkAddresses);
      expect(verdict.ok).toBe(false);
    });

    it('accepts the same destination when its hostname is allowlisted', () => {
      expect(
        judgeGrowiUri(closedNetworkUri, closedNetworkAddresses, [
          'growi.internal',
        ]),
      ).toEqual({ ok: true });
    });

    it.each([
      ['scheme', 'http://growi.internal/', ['93.184.216.34']],
      ['port', 'https://growi.internal:3000/', ['93.184.216.34']],
      ['private-address', 'https://growi.internal/', ['10.0.0.5']],
    ] as ReadonlyArray<
      [string, string, ReadonlyArray<string>]
    >)('exempts the %s condition, which is rejected without the allowList', (_condition, uri, addresses) => {
      expect(judgeGrowiUri(uri, addresses).ok).toBe(false);
      expect(judgeGrowiUri(uri, addresses, ['growi.internal'])).toEqual({
        ok: true,
      });
    });

    it('accepts an allowlisted hostname even when no address could be resolved', () => {
      // Internal-only DNS may not resolve from where the caller runs; the
      // operator's explicit declaration still stands.
      expect(judgeGrowiUri(closedNetworkUri, [], ['growi.internal'])).toEqual({
        ok: true,
      });
    });

    it('accepts an allowlisted IP-literal destination', () => {
      // Writing the address straight into the URI is ordinary in a closed
      // network, and it must be matchable as a hostname.
      expect(
        judgeGrowiUri('http://10.0.0.5:3000/', ['10.0.0.5'], ['10.0.0.5']),
      ).toEqual({ ok: true });
    });

    it.each([
      'file://growi.internal/etc/passwd',
      'gopher://growi.internal/',
      'ws://growi.internal/',
    ])('does not exempt %s even for an allowlisted hostname', (uri) => {
      // What Requirement 13 needs is plain http; lifting the scheme condition
      // altogether would let anyone who knows one allowlisted hostname hand a
      // local path to the proxy.
      expect(judgeGrowiUri(uri, ['10.0.0.5'], ['growi.internal'])).toEqual({
        ok: false,
        reason: 'scheme',
      });
    });

    it('rejects an IP-literal destination that is not allowlisted', () => {
      expect(judgeGrowiUri('https://169.254.169.254/', []).ok).toBe(false);
    });

    it('leaves a non-allowlisted destination judged normally', () => {
      expect(
        judgeGrowiUri(closedNetworkUri, closedNetworkAddresses, [
          'other.internal',
        ]),
      ).toEqual({ ok: false, reason: 'scheme' });
    });

    it('treats an empty allowList the same as none', () => {
      expect(
        judgeGrowiUri(closedNetworkUri, closedNetworkAddresses, []),
      ).toEqual(judgeGrowiUri(closedNetworkUri, closedNetworkAddresses));
    });
  });

  describe('matching is by hostname, never by resolved address', () => {
    it('keeps accepting an allowlisted hostname whatever it resolves to', () => {
      // Two calls standing for two moments in time. The operator declared the
      // NAME as trusted, so the verdict must not move when resolution changes.
      const first = judgeGrowiUri(
        'http://growi.internal:3000/',
        ['10.0.0.5'],
        ['growi.internal'],
      );
      const second = judgeGrowiUri(
        'http://growi.internal:3000/',
        ['192.168.10.20'],
        ['growi.internal'],
      );

      expect(first).toEqual({ ok: true });
      expect(second).toEqual({ ok: true });
    });

    it('does not extend the exemption to another hostname sharing the address', () => {
      // The reverse of the rule above: an attacker-controlled name that
      // happens to resolve to the same address as an allowlisted one gets no
      // exemption at all.
      expect(
        judgeGrowiUri(
          'http://attacker.example.com:3000/',
          ['10.0.0.5'],
          ['growi.internal'],
        ),
      ).toEqual({ ok: false, reason: 'scheme' });

      expect(
        judgeGrowiUri(
          'https://attacker.example.com/',
          ['10.0.0.5'],
          ['growi.internal'],
        ),
      ).toEqual({ ok: false, reason: 'private-address' });
    });

    it('matches the hostname exactly -- no suffix or substring match', () => {
      const allowList = ['growi.internal'];

      expect(
        judgeGrowiUri('https://evil-growi.internal/', ['10.0.0.5'], allowList),
      ).toEqual({ ok: false, reason: 'private-address' });
      expect(
        judgeGrowiUri(
          'https://growi.internal.attacker.com/',
          ['10.0.0.5'],
          allowList,
        ),
      ).toEqual({ ok: false, reason: 'private-address' });
      expect(
        judgeGrowiUri('https://sub.growi.internal/', ['10.0.0.5'], allowList),
      ).toEqual({ ok: false, reason: 'private-address' });
      expect(
        judgeGrowiUri('https://growi.interna/', ['10.0.0.5'], allowList),
      ).toEqual({ ok: false, reason: 'private-address' });
    });

    it('ignores the port when matching the hostname', () => {
      expect(
        judgeGrowiUri(
          'http://growi.internal:8080/',
          ['10.0.0.5'],
          ['growi.internal'],
        ),
      ).toEqual({ ok: true });
    });

    it('matches case-insensitively and ignores a trailing dot', () => {
      expect(
        judgeGrowiUri(
          'http://GROWI.Internal.:3000/',
          ['10.0.0.5'],
          ['growi.internal'],
        ),
      ).toEqual({ ok: true });
      expect(
        judgeGrowiUri(
          'http://growi.internal:3000/',
          ['10.0.0.5'],
          ['GROWI.Internal.'],
        ),
      ).toEqual({ ok: true });
    });

    it('matches an allowlisted IPv6 literal written with brackets in the URI', () => {
      expect(
        judgeGrowiUri('http://[fd00::5]:3000/', ['fd00::5'], ['fd00::5']),
      ).toEqual({ ok: true });
    });
  });
});
