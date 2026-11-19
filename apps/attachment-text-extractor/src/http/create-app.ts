import { Hono } from 'hono';

import { writeToStderr } from '../config/leveled-log';
import type { Settings } from '../config/load-settings';
import type { ConversionRunner } from '../runner';
import type { AppEnv } from './app-env';
import { bearerAuth } from './bearer-auth';
import { createConcurrencySlots } from './concurrency-slots';
import { registerExtractRoute } from './extract-route';
import { registerHealthRoutes } from './health-routes';
import { countResponses, registerMetricsRoute } from './metrics-route';
import { registerOpenApiRoute } from './openapi-route';
import { createRequestLog } from './request-log';
import { createServiceMetrics } from './service-metrics';

export interface AppDeps {
  readonly settings: Settings;
  readonly runner: ConversionRunner;
  /** Where each request log line goes; standard error when omitted. */
  readonly writeLog?: (line: string) => void;
}

// Exactly the documented operations plus GET /openapi.json and GET /metrics:
// no /docs or /redoc (D3), and no extra method routes, so a wrong method is a
// 404 (7.6).
export const createApp = ({
  settings,
  runner,
  writeLog = writeToStderr,
}: AppDeps): Hono<AppEnv> => {
  const slots = createConcurrencySlots(settings.maxConcurrency);
  const metrics = createServiceMetrics(slots);
  const app = new Hono<AppEnv>();
  app.use('*', countResponses(metrics));
  app.use('*', bearerAuth(settings.serviceToken));
  registerHealthRoutes(app, runner);
  registerOpenApiRoute(app);
  registerMetricsRoute(app, metrics);
  registerExtractRoute(app, {
    settings,
    runner,
    log: createRequestLog(settings.logLevel, writeLog, metrics.recordExtract),
    slots,
  });
  return app;
};
