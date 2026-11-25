import type { Hono, MiddlewareHandler } from 'hono';

import type { AppEnv } from './app-env';
import { endpointOf } from './request-target';
import type { ServiceMetrics } from './service-metrics';

/**
 * Counts every answer Hono produces, with the status it has once the rest of
 * the chain (the token check, a route, the 404 or the 500 of a throwing
 * route) has made it. Placed first, so a 401 is counted too.
 */
export const countResponses =
  (metrics: ServiceMetrics): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    await next();
    metrics.countResponse(endpointOf(c.env.incoming.url), c.res.status);
  };

// No describeRoute: like /openapi.json, it stays out of the OpenAPI document
// and so out of the generated client.
export const registerMetricsRoute = (
  app: Hono<AppEnv>,
  metrics: ServiceMetrics,
): void => {
  app.get('/metrics', async (c) => {
    const { body, contentType } = await metrics.render();
    return c.body(body, 200, { 'Content-Type': contentType });
  });
};
