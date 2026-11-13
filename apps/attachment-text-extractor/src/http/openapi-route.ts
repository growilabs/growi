import type { Hono } from 'hono';
import { generateSpecs } from 'hono-openapi';

import type { AppEnv } from './app-env';

// The only configuration written for the document alone (Req 7.6).
const INFO = {
  title: 'Attachment Text Extractor',
  description: 'Attachment text extraction microservice for GROWI.',
  version: '1.0.0',
} as const;

/** The OpenAPI document of the routes registered on `app` (research.md 17.13). */
export const generateOpenApiDocument = (app: Hono<AppEnv>): Promise<unknown> =>
  generateSpecs(app, { documentation: { info: INFO } });

export const registerOpenApiRoute = (app: Hono<AppEnv>): void => {
  // Generated at the first request, once every route is registered, and kept:
  // the routes of an app do not change after that.
  let document: Promise<unknown> | undefined;
  app.get('/openapi.json', async (c) => {
    document ??= generateOpenApiDocument(app);
    return c.json(await document);
  });
};
