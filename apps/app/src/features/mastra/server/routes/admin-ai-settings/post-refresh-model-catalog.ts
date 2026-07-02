import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import type { RefreshModelCatalogResponse } from '../../../interfaces/refresh-model-catalog-response';
import { refreshModelCatalog } from '../../services/ai-sdk-modules/refresh-model-catalog';

const logger = loggerFactory(
  'growi:features:mastra:routes:admin-ai-settings:post-refresh-model-catalog',
);

/**
 * @swagger
 *
 * components:
 *   schemas:
 *     RefreshModelCatalogResponse:
 *       description: >-
 *         Metadata of a successful model-catalog refresh. Carries the fetch
 *         timestamp and per-provider selectable-model counts only — never an
 *         API key, provider credentials, or providerOptions (Req 7.1).
 *       type: object
 *       required: [fetchedAt, counts]
 *       properties:
 *         fetchedAt:
 *           type: string
 *           format: date-time
 *           description: When the catalog snapshot was fetched from models.dev.
 *         counts:
 *           type: object
 *           description: provider → number of selectable model ids.
 *           additionalProperties:
 *             type: integer
 */

/**
 * @swagger
 *
 *    /ai-settings/refresh-model-catalog:
 *      post:
 *        tags: [AiSettings]
 *        security:
 *          - bearer: []
 *          - accessTokenInQuery: []
 *          - accessTokenHeaderAuth: []
 *        summary: /ai-settings/refresh-model-catalog
 *        description: >-
 *          Refresh the selectable-model catalog from models.dev (the fixed
 *          built-in source) and persist it for subsequent available-models
 *          lookups. Admin-only. On failure the last-good catalog stays in
 *          effect.
 *        responses:
 *          200:
 *            description: The catalog was refreshed and persisted.
 *            content:
 *              application/json:
 *                schema:
 *                  $ref: '#/components/schemas/RefreshModelCatalogResponse'
 *          500:
 *            description: >-
 *              The refresh failed (network / upstream schema drift); the
 *              last-good catalog is preserved.
 */

/**
 * POST /_api/v3/ai-settings/refresh-model-catalog handler.
 *
 * Triggers the runtime catalog refresh (Req 9.1): fetch models.dev (fixed
 * built-in URL — the request carries no target, Req 9.7), validate/filter with
 * the same rules as the bundled asset, persist, and answer with refresh
 * metadata only. On any failure the service throws BEFORE persisting, so the
 * last-good catalog stays in effect (Req 9.4) and this handler answers a
 * generic 500 without leaking internals.
 */
export const postRefreshModelCatalog = async (
  _req: Request,
  res: ApiV3Response,
): Promise<void> => {
  try {
    const { models, fetchedAt } = await refreshModelCatalog();

    const counts = Object.fromEntries(
      Object.entries(models).map(([provider, ids]) => [provider, ids.length]),
    );
    const response: RefreshModelCatalogResponse = {
      fetchedAt: fetchedAt.toISOString(),
      counts,
    };
    res.apiv3(response);
  } catch (err) {
    // Expected failure sources: models.dev unreachable / HTTP error / schema
    // drift / empty provider. Log the detail; answer generically (no internals,
    // no upstream body — Req 7.1 discipline).
    logger.error('Failed to refresh the model catalog', err);
    res.apiv3Err(new ErrorV3('Failed to refresh the model catalog'), 500);
  }
};

/**
 * POST /_api/v3/ai-settings/refresh-model-catalog handler factory.
 *
 * Returns the full middleware chain (WRITE scope gate + login + admin
 * authorization + the handler), matching the mastra route convention where each
 * handler factory owns its middleware and the router just mounts the array
 * (same shape as putAiSettingsFactory). NO ai-ready guard: admins must be able
 * to refresh the catalog even while AI is disabled/unconfigured (Req 1).
 *
 * Intentionally NOT gated by env-only mode (env:useOnlyEnvVars:ai): the catalog
 * is a server-side cache of public model metadata, not an AI setting — env-only
 * deployments (e.g. GROWI.cloud) must still be able to refresh it (Req 9.1).
 */
export const postRefreshModelCatalogFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const adminRequired = adminRequiredFactory(crowi);

  return [
    accessTokenParser([SCOPE.WRITE.ADMIN.AI], { acceptLegacy: true }),
    loginRequiredStrictly,
    adminRequired,
    postRefreshModelCatalog,
  ];
};
