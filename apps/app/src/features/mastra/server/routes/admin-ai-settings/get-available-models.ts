import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

import { isAiProvider } from '~/features/mastra/interfaces/ai-provider';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import type { SelectableModelsResponse } from '../../../interfaces/selectable-models-response';
import { getSelectableModelIds } from '../../services/ai-sdk-modules/model-catalog';

const logger = loggerFactory(
  'growi:features:mastra:routes:admin-ai-settings:get-available-models',
);

/**
 * @swagger
 *
 * components:
 *   schemas:
 *     SelectableModelsResponse:
 *       description: >-
 *         The selectable model ids for a provider, narrowed to chat + tool-capable
 *         models at vendoring time. Carries model-id information only — never an
 *         API key, provider credentials, or providerOptions (Req 7.1).
 *       type: object
 *       required: [modelIds]
 *       properties:
 *         modelIds:
 *           type: array
 *           description: >-
 *             The bare model ids offered for selection. An empty array for a valid
 *             but catalog-less provider (e.g. azure-openai).
 *           items:
 *             type: string
 */

/**
 * @swagger
 *
 *    /ai-settings/available-models:
 *      get:
 *        tags: [AiSettings]
 *        security:
 *          - bearer: []
 *          - accessTokenInQuery: []
 *          - accessTokenHeaderAuth: []
 *        summary: /ai-settings/available-models
 *        description: >-
 *          Get the selectable model ids for a provider from the committed offline
 *          catalog. The response carries model-id information only (no secrets).
 *        parameters:
 *          - name: provider
 *            in: query
 *            required: true
 *            schema:
 *              type: string
 *              enum: [openai, anthropic, google, azure-openai]
 *            description: The provider to scope the model list to.
 *        responses:
 *          200:
 *            description: >-
 *              The selectable model ids. An empty array for a valid but
 *              catalog-less provider (e.g. azure-openai).
 *            content:
 *              application/json:
 *                schema:
 *                  $ref: '#/components/schemas/SelectableModelsResponse'
 *          400:
 *            description: The provider query parameter is missing or not a known provider.
 *          500:
 *            description: Failed to get available models.
 */

/**
 * GET /_api/v3/ai-settings/available-models handler.
 *
 * Validates the `provider` query against the provider allow-list (`isAiProvider`)
 * and, when valid, returns the selectable model ids from the committed offline
 * catalog. The lookup is a pure in-process read (no network / DB), so a valid but
 * catalog-less provider (e.g. `azure-openai`) naturally yields `{ modelIds: [] }`
 * with 200 semantics — no special case (Req 3.1).
 *
 * The response carries ONLY `modelIds` — never an API key, provider credentials,
 * or providerOptions (Req 7.1). An invalid/missing provider is a 400 and never
 * reaches the catalog (input validation). Middleware (scope + login + adminRequired)
 * is composed in `getAvailableModelsFactory` below (Req 7.2).
 */
export const getAvailableModels = (req: Request, res: ApiV3Response): void => {
  const { provider } = req.query;

  // Allow-list validation — reject anything that is not a known provider before
  // touching the catalog (input validation, Req 7.1 boundary).
  if (!isAiProvider(provider)) {
    res.apiv3Err(new ErrorV3('Invalid provider'), 400);
    return;
  }

  try {
    const modelIds = getSelectableModelIds(provider);
    const response: SelectableModelsResponse = { modelIds };
    res.apiv3(response);
  } catch (err) {
    // The offline catalog read is the only failure source; surface a generic
    // message so no internal detail leaks to the client.
    logger.error('Failed to get available models', err);
    res.apiv3Err(new ErrorV3('Failed to get available models'), 500);
  }
};

/**
 * GET /_api/v3/ai-settings/available-models handler factory.
 *
 * Returns the full middleware chain (scope gate + login + admin authorization +
 * the handler), matching the mastra route convention where each handler factory
 * owns its middleware and the router just mounts the array (same shape as
 * getAiSettingsFactory). NO ai-ready guard is attached: admins must reach this
 * even while AI is disabled/unconfigured (Req 1).
 */
export const getAvailableModelsFactory = (crowi: Crowi): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const adminRequired = adminRequiredFactory(crowi);

  return [
    accessTokenParser([SCOPE.READ.ADMIN.AI], { acceptLegacy: true }),
    loginRequiredStrictly,
    adminRequired,
    getAvailableModels,
  ];
};
