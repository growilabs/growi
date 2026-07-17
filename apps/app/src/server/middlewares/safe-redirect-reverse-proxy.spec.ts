import express from 'express';
import request from 'supertest';

import registerSafeRedirectFactory, {
  type ResWithSafeRedirect,
} from './safe-redirect';

/**
 * Reproduction for issue #11248 (login error under an nginx reverse proxy) and its
 * relationship to issue #11384.
 *
 * Contract under test: what the browser's login XHR actually receives from the server
 * — the HTTP transport (302 + Location scheme/host, or a JSON body). The browser's
 * Mixed Content block is the well-known downstream consequence of a `Location: http://…`
 * on a request initiated from an https page; we measure the server-observable Location,
 * not the browser block itself.
 *
 * Scenario mirrors the report: TLS is terminated at the proxy, which forwards to the app
 * over plain HTTP with `X-Forwarded-Proto: https` and `Host: mydomain` (no port).
 */
describe('safeRedirect under a TLS-terminating reverse proxy (#11248 / #11384)', () => {
  const PROXY_HEADERS = {
    Host: 'mydomain',
    'X-Forwarded-Proto': 'https',
  } as const;

  // A route that reproduces the PRE-#11384 external-account (LDAP) success path:
  // the AJAX login endpoint replied with an HTTP 302 via res.safeRedirect('/').
  // The browser XHR follows a 302 silently.
  const buildLegacy302App = (opts: { trustProxy?: boolean } = {}) => {
    const app = express();
    if (opts.trustProxy) {
      app.set('trust proxy', true);
    }
    app.use(registerSafeRedirectFactory([]));
    app.get('/_api/v3/login', (_req, res) => {
      // WHY: safeRedirect is attached to res at runtime by the middleware above;
      // Express's Response type does not know about it, so narrow it here.
      (res as ResWithSafeRedirect).safeRedirect('/');
    });
    return app;
  };

  // A route that reproduces the POST-#11384 transport used by BOTH local and LDAP
  // login: a JSON body, never a redirect.
  const buildFixedJsonApp = () => {
    const app = express();
    app.use(registerSafeRedirectFactory([]));
    app.get('/_api/v3/login', (_req, res) => {
      res.json({ redirectTo: '/' });
    });
    return app;
  };

  describe('PRE-#11384 behaviour: AJAX login replies with a 302', () => {
    it('emits an INSECURE http:// Location when trust proxy is OFF (reproduces the bug)', async () => {
      const app = buildLegacy302App({ trustProxy: false });

      const res = await request(app)
        .get('/_api/v3/login')
        .set(PROXY_HEADERS)
        .redirects(0); // observe the 302 the browser XHR would follow

      expect(res.status).toBe(302);
      // The exact string reported in #11248. The browser blocks following this
      // as Mixed Content because the page was loaded over https.
      expect(res.headers.location).toBe('http://mydomain/');
      expect(res.headers.location.startsWith('http://')).toBe(true);
    });

    it('emits a secure https:// Location when trust proxy is ON (the TRUST_PROXY_BOOL workaround)', async () => {
      const app = buildLegacy302App({ trustProxy: true });

      const res = await request(app)
        .get('/_api/v3/login')
        .set(PROXY_HEADERS)
        .redirects(0);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://mydomain/');
      expect(res.headers.location.startsWith('https://')).toBe(true);
    });
  });

  describe('POST-#11384 behaviour: AJAX login replies with JSON', () => {
    it('never issues a 302, so there is no Location for the XHR to follow (fix resolves #11248)', async () => {
      // Even with trust proxy OFF — the condition that produced the bad Location above.
      const app = buildFixedJsonApp();

      const res = await request(app)
        .get('/_api/v3/login')
        .set(PROXY_HEADERS)
        .redirects(0);

      expect(res.status).toBe(200);
      expect(res.headers.location).toBeUndefined();
      expect(res.body).toEqual({ redirectTo: '/' });
    });
  });
});
