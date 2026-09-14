import type { IUserHasId } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import { mock } from 'vitest-mock-extended';

const consumePoints = vi.hoisted(() => vi.fn());

vi.mock('./consume-points', () => ({ consumePoints }));

import {
  DEFAULT_MAX_REQUESTS,
  DEFAULT_USERS_PER_IP_PROSPECTION,
  type IApiRateLimitConfig,
} from '../config';
import { middlewareFactory } from './factory';

type ConsumeCall = {
  config: IApiRateLimitConfig | undefined;
  ipMultiplier: number | undefined;
};

/**
 * Asserted through the middleware rather than by reading `defaultConfig`, so the
 * path matching is exercised too: an entry keyed on the wrong path form would
 * still satisfy a test that only inspected the map.
 *
 * `user` must be overridden to `undefined` explicitly — `mock<T>()` auto-stubs
 * every unspecified member, so `req.user` would otherwise be a truthy stub and
 * the middleware would also make the user-keyed consume, which carries no
 * multiplier. Anonymous leaves only the per-IP call, the one under test here.
 */
const consumeCallsFor = async (path: string): Promise<ConsumeCall[]> => {
  consumePoints.mockReset();
  consumePoints.mockResolvedValue(undefined);

  const req = mock<Request & { user?: IUserHasId }>({
    path,
    method: 'GET',
    ip: '127.0.0.1',
    user: undefined,
  });
  const res = mock<Response>();
  const next: NextFunction = vi.fn();

  await middlewareFactory()(req, res, next);

  expect(next).toHaveBeenCalled();
  expect(consumePoints).toHaveBeenCalled();
  return consumePoints.mock.calls.map(([, , config, ipMultiplier]) => ({
    config,
    ipMultiplier,
  }));
};

const configsUsedFor = async (
  path: string,
): Promise<(IApiRateLimitConfig | undefined)[]> =>
  (await consumeCallsFor(path)).map(({ config }) => config);

describe('middlewareFactory', () => {
  it('limits the username-suggestion endpoint more tightly than the global default', async () => {
    const configs = await configsUsedFor('/_api/v3/users/usernames');

    for (const config of configs) {
      expect(config?.maxRequests).toBeLessThan(DEFAULT_MAX_REQUESTS);
    }
  });

  /**
   * The per-IP allowance is `maxRequests x usersPerIpProspection`. Every
   * logged-in user hits this endpoint, so at the default prospection a shared
   * egress IP would 429 on legitimate typing. Asserted as "more than the
   * default" rather than pinned to a number — the intent is what matters, and
   * deleting the field would silently restore the NAT problem.
   */
  it('assumes more users per IP than the default for the username endpoint', async () => {
    const calls = await consumeCallsFor('/_api/v3/users/usernames');

    for (const { ipMultiplier } of calls) {
      expect(ipMultiplier).toBeGreaterThan(DEFAULT_USERS_PER_IP_PROSPECTION);
    }
  });

  it('leaves an endpoint with no entry on the global default', async () => {
    // Control for the case above: without it, a lookup that returned a tighter
    // config for everything would pass.
    const configs = await configsUsedFor(
      '/_api/v3/some-endpoint-with-no-entry',
    );

    for (const config of configs) {
      expect(config).toBeUndefined();
    }
  });
});
