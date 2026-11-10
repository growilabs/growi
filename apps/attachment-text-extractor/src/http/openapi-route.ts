import type { Hono } from 'hono';

import type { AppEnv } from './app-env';
import openApiDocument from './openapi.json' with { type: 'json' };

// The service owns its OpenAPI document as a file: the committed client
// document with the 7.1 descriptions rewritten (research.md 17.1, 17.6).
export { openApiDocument };

export const registerOpenApiRoute = (app: Hono<AppEnv>): void => {
  app.get('/openapi.json', (c) => c.json(openApiDocument));
};
