import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { query, type ValidationChain } from 'express-validator';

import {
  type AiProvider,
  isAiProvider,
} from '~/features/mastra/interfaces/ai-provider';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
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
 * Validators for GET /_api/v3/ai-settings/available-models.
 *
 * `provider` is required and must be one of the supported providers; the
 * allow-list membership is checked with `isAiProvider` (mirrors the
 * `body('provider')` rule in put-ai-settings). A missing/invalid provider fails
 * here and is turned into a 400 by `apiV3FormValidator`, so the handler never has
 * to re-validate the query (Req 7.1 boundary).
 */
export const getAvailableModelsValidators: ValidationChain[] = [
  query('provider')
    .custom((value) => isAiProvider(value))
    .withMessage('provider must be one of the supported AI providers'),
];

/**
 * GET /_api/v3/ai-settings/available-models handler.
 *
 * Returns the selectable model ids for `provider` from the committed offline
 * catalog. The lookup is a pure in-process read (no network / DB), so a valid but
 * catalog-less provider (e.g. `azure-openai`) naturally yields `{ modelIds: [] }`
 * with 200 semantics — no special case (Req 3.1).
 *
 * The response carries ONLY `modelIds` — never an API key, provider credentials,
 * or providerOptions (Req 7.1). Input validation lives in the middleware chain
 * (`getAvailableModelsValidators` + `apiV3FormValidator`), so an invalid/missing
 * provider is a 400 before this runs; scope + login + adminRequired are composed
 * in `getAvailableModelsFactory` below (Req 7.2).
 */
export const getAvailableModels = (req: Request, res: ApiV3Response): void => {
  // `provider` is validated upstream (getAvailableModelsValidators +
  // apiV3FormValidator), so it is a known AiProvider by the time we get here.
  // req.query is ParsedQs (not `any`), hence the annotation on the trusted value.
  const provider = req.query.provider as AiProvider;

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
 * provider validation + the handler), matching the mastra route convention where
 * each handler factory owns its middleware and the router just mounts the array
 * (same shape as getAiSettingsFactory / putAiSettingsFactory). Validation is done
 * with express-validator (getAvailableModelsValidators) + apiV3FormValidator, like
 * put-ai-settings. NO ai-ready guard is attached: admins must reach this even
 * while AI is disabled/unconfigured (Req 1).
 */
export const getAvailableModelsFactory = (crowi: Crowi): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const adminRequired = adminRequiredFactory(crowi);

  return [
    accessTokenParser([SCOPE.READ.ADMIN.AI], { acceptLegacy: true }),
    loginRequiredStrictly,
    adminRequired,
    ...getAvailableModelsValidators,
    apiV3FormValidator,
    getAvailableModels,
  ];
};
