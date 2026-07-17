import express from 'express';
import request from 'supertest';

import registerSafeRedirectFactory, {
  type ResWithSafeRedirect,
} from './safe-redirect';

// Control app:siteUrl without loading the real config store.
const { getConfigMock } = vi.hoisted(() => ({ getConfigMock: vi.fn() }));
vi.mock('../service/config-manager', () => ({
  configManager: { getConfig: getConfigMock },
}));

/**
 * End-to-end regression for issue #11248: a full-page auth callback issues an HTTP 302
 * via res.safeRedirect while the app runs behind a TLS-terminating reverse proxy with
 * `trust proxy` OFF. Contract under test: the scheme/host/port of the emitted Location,
 * measured over a real Express round-trip.
 *
 * Reported environment: proxy terminates TLS and forwards over http with
 * `X-Forwarded-Proto: https` and `Host: mydomain` (no port).
 */
describe('safeRedirect end-to-end under a TLS-terminating reverse proxy (#11248)', () => {
  const PROXY_HEADERS = {
    Host: 'mydomain',
    'X-Forwarded-Proto': 'https',
  } as const;

  const buildApp = () => {
    const app = express();
    // `trust proxy` is intentionally left OFF — this is the reported misconfiguration.
    app.use(registerSafeRedirectFactory([]));
    app.get('/callback', (_req, res) => {
      (res as ResWithSafeRedirect).safeRedirect('/');
    });
    return app;
  };

  it('emits the configured https origin (with port) when app:siteUrl is set — fix for #11248', async () => {
    getConfigMock.mockReturnValue('https://mydomain:4443');

    const res = await request(buildApp())
      .get('/callback')
      .set(PROXY_HEADERS)
      .redirects(0);

    expect(res.status).toBe(302);
    // Before the fix this was `http://mydomain/`, which a browser blocks as Mixed Content.
    expect(res.headers.location).toBe('https://mydomain:4443/');
  });

  it('falls back to the request-derived origin when app:siteUrl is unset', async () => {
    getConfigMock.mockReturnValue(undefined);

    const res = await request(buildApp())
      .get('/callback')
      .set(PROXY_HEADERS)
      .redirects(0);

    expect(res.status).toBe(302);
    // With neither `trust proxy` nor app:siteUrl the https scheme cannot be recovered.
    // This documents why TRUST_PROXY_BOOL is still required in that configuration.
    expect(res.headers.location).toBe('http://mydomain/');
  });

  it('still blocks an open-redirect attempt regardless of proxy headers', async () => {
    getConfigMock.mockReturnValue('https://mydomain:4443');

    const app = express();
    app.use(registerSafeRedirectFactory([]));
    app.get('/callback', (_req, res) => {
      (res as ResWithSafeRedirect).safeRedirect('//evil.example.com');
    });

    const res = await request(app)
      .get('/callback')
      .set(PROXY_HEADERS)
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });
});
