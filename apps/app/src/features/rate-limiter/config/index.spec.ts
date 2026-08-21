import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_REQUESTS,
  DEFAULT_USERS_PER_IP_PROSPECTION,
  defaultConfig,
} from '.';

/**
 * The rate-limit middleware matches `req.path` against these keys EXACTLY
 * (see middleware/factory.ts: `configWithoutRegExp[endpoint]`). A key that is
 * not the fully-mounted path silently matches nothing and the endpoint falls
 * back to the permissive default — there is no error, no warning, and nothing
 * at runtime that reveals the key is dead. That makes this a drift spec: it
 * pins the mounted paths so the next router remount fails here instead of
 * quietly un-throttling an unauthenticated endpoint.
 *
 * That is exactly what had happened: `/login`, `/invited`, `/register`,
 * `/user-activation/register` and the installer POST were all keyed by their
 * pre-mount router paths while being registered on routers mounted at
 * '/_api/v3' (server/routes/index.js). Each runs a password hash (scrypt,
 * ~128MiB / ~100ms on a libuv thread) for an unauthenticated caller, so an
 * un-throttled one is a threadpool-exhaustion lever.
 */

/** Fully-mounted paths of the unauthenticated, scrypt-bearing auth endpoints. */
const SCRYPT_BEARING_AUTH_ENDPOINTS = [
  '/_api/v3/login',
  '/_api/v3/invited',
  '/_api/v3/register',
  '/_api/v3/user-activation/register',
  // routerForAdmin, same '/_api/v3' mount; the bare '/installer' matched only
  // the legacy GET page, leaving the scrypt-running POST unthrottled.
  '/_api/v3/installer',
] as const;

/** The pre-mount keys that used to be here and matched no live request. */
const DEAD_PRE_MOUNT_KEYS = [
  '/login',
  '/invited',
  '/register',
  '/user-activation/register',
] as const;

/**
 * What an endpoint with NO matching key gets: `consumePoints` falls back to
 * DEFAULT_MAX_REQUESTS and `consumePointsByIp` multiplies by
 * DEFAULT_USERS_PER_IP_PROSPECTION. Any configured endpoint must stay strictly
 * under this, otherwise configuring it bought nothing.
 */
const PERMISSIVE_DEFAULT_CEILING_PER_IP =
  DEFAULT_MAX_REQUESTS * DEFAULT_USERS_PER_IP_PROSPECTION;

/**
 * Reproduces the per-IP ceiling the middleware actually enforces for a config:
 * `maxRequests` scaled by `usersPerIpProspection` (or the default when the
 * config omits it). Asserting on this composite — rather than on each field —
 * is what makes a `usersPerIpProspection` bump (e.g. 100 → 1000) fail here.
 */
const effectiveCeilingPerIp = (endpoint: string): number => {
  const config = defaultConfig[endpoint];
  return (
    config.maxRequests *
    (config.usersPerIpProspection ?? DEFAULT_USERS_PER_IP_PROSPECTION)
  );
};

describe('rate-limiter defaultConfig — unauthenticated scrypt-bearing endpoints', () => {
  it.each(
    SCRYPT_BEARING_AUTH_ENDPOINTS,
  )('keys %s by its fully-mounted apiv3 path', (endpoint) => {
    expect(defaultConfig[endpoint]).toBeDefined();
    // apiV3AuthRouter's mount prefix — omitting it is the exact bug this guards.
    expect(endpoint.startsWith('/_api/v3/')).toBe(true);
    expect(defaultConfig[endpoint].method).toBe('POST');
  });

  it.each(DEAD_PRE_MOUNT_KEYS)('does not keep the dead %s key', (endpoint) => {
    expect(defaultConfig[endpoint]).toBeUndefined();
  });

  it.each(
    SCRYPT_BEARING_AUTH_ENDPOINTS,
  )('throttles %s strictly below the permissive default', (endpoint) => {
    // A key whose effective ceiling reaches the fallback is a no-op key.
    expect(effectiveCeilingPerIp(endpoint)).toBeLessThan(
      PERMISSIVE_DEFAULT_CEILING_PER_IP,
    );
  });

  it('keeps a separate entry for the legacy GET /installer page', () => {
    // Retargeting the POST to '/_api/v3/installer' once dropped this entry and
    // widened the page's ceiling 5x — see the config for why a method-mismatched
    // key is not inert.
    const config = defaultConfig['/installer'];

    expect(config).toBeDefined();
    expect(config.method).toBe('GET');
    expect(config.usersPerIpProspection).toBe(1);
    expect(effectiveCeilingPerIp('/installer')).toBeLessThan(
      PERMISSIVE_DEFAULT_CEILING_PER_IP,
    );
  });

  it('keeps login itself on the tightest per-request tier', () => {
    const config = defaultConfig['/_api/v3/login'];

    // One scrypt verification per request: keep the per-IP burst small.
    expect(config.maxRequests).toBeLessThanOrEqual(5);
    // Login is shared by every user behind a corporate NAT, hence the wide
    // prospection — but it must not be so wide that the ceiling stops binding
    // (that is already covered above; this pins the intended order of magnitude).
    expect(config.usersPerIpProspection).toBe(100);
  });
});
