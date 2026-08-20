import type { NextFunction, Request, Response } from 'express';
import { mock } from 'vitest-mock-extended';

const consumePoints = vi.hoisted(() => vi.fn());

vi.mock('./consume-points', () => ({ consumePoints }));

import { DEFAULT_MAX_REQUESTS, type IApiRateLimitConfig } from '../config';
import { middlewareFactory } from './factory';

/**
 * Asserted through the middleware rather than by reading `defaultConfig`, so the
 * path matching is exercised too: an entry keyed on the wrong path form would
 * still satisfy a test that only inspected the map.
 */
const configsUsedFor = async (
  path: string,
): Promise<(IApiRateLimitConfig | undefined)[]> => {
  consumePoints.mockReset();
  consumePoints.mockResolvedValue(undefined);

  const req = mock<Request>({ path, method: 'GET', ip: '127.0.0.1' });
  const res = mock<Response>();
  const next: NextFunction = vi.fn();

  await middlewareFactory()(req, res, next);

  expect(next).toHaveBeenCalled();
  expect(consumePoints).toHaveBeenCalled();
  return consumePoints.mock.calls.map(([, , config]) => config);
};

describe('middlewareFactory', () => {
  it('limits the username-suggestion endpoint more tightly than the global default', async () => {
    const configs = await configsUsedFor('/_api/v3/users/usernames');

    for (const config of configs) {
      expect(config?.maxRequests).toBeLessThan(DEFAULT_MAX_REQUESTS);
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
