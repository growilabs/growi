import { Hono } from 'hono';

import { writeToStderr } from '../config/leveled-log';
import type { Settings } from '../config/load-settings';
import type { ConversionRunner } from '../runner';
import type { AppEnv } from './app-env';
import { bearerAuth } from './bearer-auth';
import { registerExtractRoute } from './extract-route';
import { registerHealthRoutes } from './health-routes';
import { registerOpenApiRoute } from './openapi-route';
import { createRequestLog } from './request-log';

export interface AppDeps {
  readonly settings: Settings;
  readonly runner: ConversionRunner;
  /** Where each request log line goes; standard error when omitted. */
  readonly writeLog?: (line: string) => void;
}

// Exactly the documented operations plus GET /openapi.json: no /docs or
// /redoc (D3), and no extra method routes, so a wrong method is a 404 (7.6).
export const createApp = ({
  settings,
  runner,
  writeLog = writeToStderr,
}: AppDeps): Hono<AppEnv> => {
  const app = new Hono<AppEnv>();
  app.use('*', bearerAuth(settings.serviceToken));
  registerHealthRoutes(app, runner);
  registerOpenApiRoute(app);
  registerExtractRoute(app, {
    settings,
    runner,
    log: createRequestLog(settings.logLevel, writeLog),
  });
  return app;
};
