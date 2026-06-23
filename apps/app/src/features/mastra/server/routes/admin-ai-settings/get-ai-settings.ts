import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

import { isAiConfigured } from '~/features/mastra/server/services/is-ai-configured';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import type { AiSettingsResponse } from '../../../interfaces/ai-settings';

const logger = loggerFactory(
  'growi:features:mastra:routes:admin-ai-settings:get-ai-settings',
);

/**
 * @swagger
 *
 * components:
 *   schemas:
 *     AiSettingsResponse:
 *       description: >-
 *         The currently effective AI configuration for the admin UI. The
 *         ai:apiKey value is never returned — only isApiKeySet exposes its presence.
 *       type: object
 *       required: [aiEnabled, azureOpenaiSettings, isApiKeySet, useOnlyEnvVars, isConfigured]
 *       properties:
 *         aiEnabled:
 *           type: boolean
 *           description: State of app:aiEnabled (the AI enable toggle).
 *         provider:
 *           type: string
 *           enum: [openai, anthropic, google, azure-openai]
 *           description: The selected LLM provider (ai:provider).
 *         allowedModels:
 *           type: array
 *           description: >-
 *             The per-model allow-list (ai:allowedModels). Each entry carries its
 *             model id (deployment name for Azure OpenAI), optional provider-namespaced
 *             providerOptions, and an isDefault flag (exactly one entry is the default).
 *             Always an array (an empty array when no models are configured).
 *           items:
 *             type: object
 *             required: [modelId]
 *             properties:
 *               modelId:
 *                 type: string
 *                 description: The model id (or, for Azure OpenAI, the deployment name).
 *               providerOptions:
 *                 type: object
 *                 description: Provider-namespaced options (e.g. {"openai":{...}}).
 *               isDefault:
 *                 type: boolean
 *                 description: Whether this entry is the default model.
 *         azureOpenaiSettings:
 *           type: object
 *           description: >-
 *             Azure OpenAI connection settings (the ai:azureOpenaiSettings object).
 *             Always present; an empty object when unset.
 *           properties:
 *             resourceName:
 *               type: string
 *             baseURL:
 *               type: string
 *             apiVersion:
 *               type: string
 *             useEntraId:
 *               type: boolean
 *               description: Whether Azure OpenAI authenticates via Microsoft Entra ID instead of an API key (absent = false).
 *         isApiKeySet:
 *           type: boolean
 *           description: Whether an ai:apiKey is stored. The key value itself is never returned.
 *         useOnlyEnvVars:
 *           type: boolean
 *           description: When true (env:useOnlyEnvVars:ai), every field is fixed by env vars and is read-only.
 *         isConfigured:
 *           type: boolean
 *           description: Whether the provider and its required fields resolve to a usable model.
 */

/**
 * @swagger
 *
 *    /ai-settings:
 *      get:
 *        tags: [AiSettings]
 *        security:
 *          - bearer: []
 *          - accessTokenInQuery: []
 *          - accessTokenHeaderAuth: []
 *        summary: /ai-settings
 *        description: Get the currently effective AI settings. The ai:apiKey value is never returned (only isApiKeySet).
 *        responses:
 *          200:
 *            description: The effective AI settings.
 *            content:
 *              application/json:
 *                schema:
 *                  $ref: '#/components/schemas/AiSettingsResponse'
 *          500:
 *            description: Failed to get AI settings.
 */

/**
 * GET /_api/v3/ai-settings handler.
 *
 * Returns the currently effective AI configuration for the admin UI. Each value
 * comes from `configManager.getConfig`, which already resolves env-only mode, so
 * the response reflects what the runtime actually uses (Req 1.4, 4.4). The
 * per-model allow-list is returned as `allowedModels` (replacing the former single
 * `model`/`providerOptions` fields), always an array (Req 1.1, 1.3).
 *
 * The `ai:apiKey` value is never returned — only `isApiKeySet` (Req 5.2). The
 * boolean flags let the UI decide editability (`useOnlyEnvVars`, Req 4.2), toggle
 * state (`aiEnabled`, Req 7.1), and whether to show the "enabled but not
 * configured" warning (`isConfigured`, Req 7.6).
 *
 * Middleware (scope + login + adminRequired) is composed in `getAiSettingsFactory`
 * below, so this is a plain terminal handler that reads config and shapes the response.
 */
export const getAiSettings = (_req: Request, res: ApiV3Response): void => {
  try {
    // Never read into a returned field — only its presence is exposed (Req 5.2).
    const apiKey = configManager.getConfig('ai:apiKey');

    // Azure connection config is one JSON object (ai:azureOpenaiSettings) shared
    // end-to-end (storage / API / form). `?? {}` guards a malformed
    // AI_AZURE_OPENAI_SETTINGS env var (loader fails soft to null) and the unset
    // case, so the response always carries an object.
    const azureOpenaiSettings =
      configManager.getConfig('ai:azureOpenaiSettings') ?? {};

    const response: AiSettingsResponse = {
      aiEnabled: configManager.getConfig('app:aiEnabled'),
      provider: configManager.getConfig('ai:provider'),
      // The per-model allow-list (incl. isDefault and providerOptions). `?? []`
      // mirrors getAllowedModels(): an absent/cleared key resolves to the default
      // empty array, so the response always carries an array (Req 1.1, 1.3). The
      // admin UI is trusted, so providerOptions ARE exposed here (unlike the chat
      // /models endpoint, which omits them).
      allowedModels: configManager.getConfig('ai:allowedModels') ?? [],
      azureOpenaiSettings,
      isApiKeySet: apiKey != null && apiKey !== '',
      useOnlyEnvVars: configManager.getConfig('env:useOnlyEnvVars:ai') === true,
      isConfigured: isAiConfigured(),
    };

    res.apiv3(response);
  } catch (err) {
    // Log without the apiKey: the caught error originates from config reads or
    // isAiConfigured() and must never carry the secret to logs or the client (Req 5.3).
    logger.error('Failed to get AI settings', err);
    res.apiv3Err(new ErrorV3('Failed to get AI settings'), 500);
  }
};

/**
 * GET /_api/v3/ai-settings handler factory.
 *
 * Returns the full middleware chain (scope gate + login + admin authorization +
 * the handler), matching the mastra route convention where each handler factory
 * owns its middleware and the router just mounts the array. NO ai-ready guard is
 * attached: admins must reach this even while AI is disabled/unconfigured (Req 1).
 */
export const getAiSettingsFactory = (crowi: Crowi): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const adminRequired = adminRequiredFactory(crowi);

  return [
    accessTokenParser([SCOPE.READ.ADMIN.AI], { acceptLegacy: true }),
    loginRequiredStrictly,
    adminRequired,
    getAiSettings,
  ];
};
