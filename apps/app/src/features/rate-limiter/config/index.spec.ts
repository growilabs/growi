import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_REQUESTS,
  DEFAULT_USERS_PER_IP_PROSPECTION,
  defaultConfig,
} from '.';

/**
 * Drift spec for the login rate-limit key.
 *
 * The middleware matches `req.path` against these keys EXACTLY (see
 * middleware/factory.ts: `configWithoutRegExp[endpoint]`). A key that is not the
 * fully-mounted path silently matches nothing and the endpoint falls back to the
 * permissive default — no error, no warning, nothing at runtime that reveals the
 * key is dead. That is what had happened to `/login`: the legacy POST route is
 * gone and the live one is on apiV3AuthRouter, mounted at '/_api/v3'.
 *
 * It matters here because verification now runs scrypt (~128MiB / ~100ms on a
 * libuv thread) for an unauthenticated caller, so an un-throttled login is a
 * threadpool-exhaustion lever. This pins the mounted path so a future remount
 * fails here instead of quietly un-throttling it again.
 */

/**
 * What an endpoint with NO matching key gets: `consumePoints` falls back to
 * DEFAULT_MAX_REQUESTS and `consumePointsByIp` multiplies by
 * DEFAULT_USERS_PER_IP_PROSPECTION. A configured endpoint must stay strictly
 * under this, otherwise configuring it bought nothing.
 */
const PERMISSIVE_DEFAULT_CEILING_PER_IP =
  DEFAULT_MAX_REQUESTS * DEFAULT_USERS_PER_IP_PROSPECTION;

describe('rate-limiter defaultConfig — login', () => {
  it('keys login by its fully-mounted apiv3 path', () => {
    expect(defaultConfig['/_api/v3/login']).toBeDefined();
    // The pre-mount key matched no live request.
    expect(defaultConfig['/login']).toBeUndefined();
  });

  it('throttles login strictly below the permissive default', () => {
    const config = defaultConfig['/_api/v3/login'];

    // Asserting the composite the middleware actually enforces — rather than
    // each field — is what makes a usersPerIpProspection bump fail here too.
    const effectiveCeilingPerIp =
      config.maxRequests *
      (config.usersPerIpProspection ?? DEFAULT_USERS_PER_IP_PROSPECTION);

    expect(config.method).toBe('POST');
    expect(effectiveCeilingPerIp).toBeLessThan(
      PERMISSIVE_DEFAULT_CEILING_PER_IP,
    );
  });
});
