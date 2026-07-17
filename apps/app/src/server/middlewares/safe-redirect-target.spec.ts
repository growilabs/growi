import {
  resolveSafeRedirect,
  type SafeRedirectContext,
} from './safe-redirect-target';

/**
 * Contract of resolveSafeRedirect: given a requested redirect and the request/site
 * context, decide the URL the client is sent to, preventing open redirects. The
 * behaviour a caller observes is (target, disposition) — NOT how it is computed.
 *
 * Regressions this guards:
 * - #11248: behind a TLS-terminating reverse proxy without `trust proxy`, req.protocol
 *   is http, so a local redirect used to be emitted as `http://host/`. When app:siteUrl
 *   is configured, the emitted URL must keep the site URL's scheme/host/port.
 * - open-redirect protection must survive the change.
 */
describe('resolveSafeRedirect', () => {
  const base = (
    overrides: Partial<SafeRedirectContext> = {},
  ): SafeRedirectContext => ({
    reqProtocol: 'https',
    reqHost: 'example.com',
    reqHostname: 'example.com',
    appSiteUrl: undefined,
    whitelistOfHosts: [],
    ...overrides,
  });

  describe('empty input', () => {
    it('returns / when redirectTo is undefined', () => {
      const r = resolveSafeRedirect(undefined, base());
      expect(r).toEqual({ target: '/', disposition: 'empty' });
    });
  });

  describe('reverse proxy without trust proxy (the #11248 scenario)', () => {
    // Proxy terminates TLS and forwards over http; req.protocol is therefore http and
    // the Host header carries no port. app:siteUrl is configured to the public URL.
    const proxyCtx = base({
      reqProtocol: 'http',
      reqHost: 'mydomain',
      reqHostname: 'mydomain',
      appSiteUrl: 'https://mydomain:4443',
    });

    it('emits the configured https origin (with port) for a local root redirect', () => {
      const r = resolveSafeRedirect('/', proxyCtx);
      expect(r).toEqual({
        target: 'https://mydomain:4443/',
        disposition: 'local',
      });
    });

    it('preserves path/hash while fixing the scheme and port', () => {
      const r = resolveSafeRedirect('/me#password_settings', proxyCtx);
      expect(r).toEqual({
        target: 'https://mydomain:4443/me#password_settings',
        disposition: 'local',
      });
    });
  });

  describe('no app:siteUrl configured (falls back to the request-derived origin)', () => {
    it('builds the local redirect from req.protocol and Host', () => {
      const r = resolveSafeRedirect(
        '/path/to/page',
        base({ reqProtocol: 'http' }),
      );
      expect(r).toEqual({
        target: 'http://example.com/path/to/page',
        disposition: 'local',
      });
    });
  });

  describe('open-redirect protection', () => {
    it('blocks protocol-relative external URLs', () => {
      const r = resolveSafeRedirect('//evil.example.com', base());
      expect(r).toEqual({ target: '/', disposition: 'blocked' });
    });

    it('blocks an absolute URL to an unlisted external host', () => {
      const r = resolveSafeRedirect('https://evil.example.com/steal', base());
      expect(r).toEqual({ target: '/', disposition: 'blocked' });
    });

    it('returns / for an unparseable redirectTo', () => {
      // A bare colon makes the WHATWG URL parser throw for both base and input.
      const r = resolveSafeRedirect('http://[', base());
      expect(r.target).toBe('/');
      expect(r.disposition).toBe('invalid');
    });
  });

  describe('whitelist', () => {
    const wl = base({
      whitelistOfHosts: ['white1.example.com:8080', 'white2.example.com'],
    });

    it('allows a whitelisted host:port and returns the original url unchanged', () => {
      const r = resolveSafeRedirect('http://white1.example.com:8080/path', wl);
      expect(r).toEqual({
        target: 'http://white1.example.com:8080/path',
        disposition: 'whitelisted',
      });
    });

    it('blocks a whitelisted hostname when the required port is missing', () => {
      const r = resolveSafeRedirect('http://white1.example.com/path', wl);
      expect(r).toEqual({ target: '/', disposition: 'blocked' });
    });

    it('allows a whitelisted bare hostname', () => {
      const r = resolveSafeRedirect('http://white2.example.com/path', wl);
      expect(r).toEqual({
        target: 'http://white2.example.com/path',
        disposition: 'whitelisted',
      });
    });
  });

  describe('canonicalisation to the configured site host', () => {
    it('treats a redirect to the configured site host as local even if the Host header differs', () => {
      const ctx = base({
        reqProtocol: 'http',
        reqHost: 'internal-name',
        reqHostname: 'internal-name',
        appSiteUrl: 'https://wiki.example.com',
      });
      const r = resolveSafeRedirect('/dashboard', ctx);
      expect(r).toEqual({
        target: 'https://wiki.example.com/dashboard',
        disposition: 'local',
      });
    });
  });
});
