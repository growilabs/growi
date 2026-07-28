import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

import {
  type AiProvider,
  mapProviders,
} from '~/features/mastra/interfaces/ai-provider';
import type {
  AiProviderStatus,
  AiSettingsResponse,
} from '~/features/mastra/interfaces/ai-settings';
import { isAiConfigured } from '~/features/mastra/server/services/is-ai-configured';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import {
  getAllowedModels,
  getApiKey,
  getProviderSettings,
} from '../../services/ai-sdk-modules/llm-providers/config';
import { buildModelDisplayNameResolver } from '../../services/ai-sdk-modules/resolve-model-display-name';

const logger = loggerFactory(
  'growi:features:mastra:routes:admin-ai-settings:get-ai-settings',
);

/**
 * @swagger
 *
 * components:
 *   schemas:
 *     AiProviderStatus:
 *       description: >-
 *         Per-provider status for the admin UI. The stored API key value is never
 *         returned — only isApiKeySet exposes its presence (Req 1.8, 1.9).
 *       type: object
 *       required: [enabled, isApiKeySet]
 *       properties:
 *         enabled:
 *           type: boolean
 *           description: Whether the provider is toggled on by the admin.
 *         isApiKeySet:
 *           type: boolean
 *           description: Whether an API key is stored for the provider. The key value itself is never returned.
 *         azureOpenaiSettings:
 *           type: object
 *           description: >-
 *             Azure OpenAI connection settings — present only on the 'azure-openai'
 *             entry. These carry no secrets, so they may be returned.
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
 *     AiSettingsResponse:
 *       description: >-
 *         The currently effective multi-provider AI configuration for the admin UI.
 *         No API key value is ever returned — only the per-provider isApiKeySet
 *         flag (Req 1.8, 1.9).
 *       type: object
 *       required: [aiEnabled, providers, allowedModels, useOnlyEnvVars, isConfigured]
 *       properties:
 *         aiEnabled:
 *           type: boolean
 *           description: State of app:aiEnabled (the AI enable toggle).
 *         providers:
 *           type: object
 *           description: >-
 *             Status of every supported provider (openai, anthropic, google,
 *             azure-openai). All four are always present as fixed slots (Req 1.1):
 *             an unconfigured provider is returned as a disabled entry, never omitted.
 *           additionalProperties:
 *             $ref: '#/components/schemas/AiProviderStatus'
 *         allowedModels:
 *           type: array
 *           description: >-
 *             The cross-provider allow-list (ai:allowedModels). Each entry carries its
 *             owning provider, model id (deployment name for Azure OpenAI), optional
 *             provider-namespaced providerOptions, and an isDefault flag (exactly one
 *             entry is the default). Always an array (empty when no models are configured).
 *           items:
 *             type: object
 *             required: [provider, modelId, displayName]
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [openai, anthropic, google, azure-openai]
 *                 description: The model's owning provider.
 *               modelId:
 *                 type: string
 *                 description: The model id (or, for Azure OpenAI, the deployment name).
 *               displayName:
 *                 type: string
 *                 description: >-
 *                   The official display name resolved from the catalog (the modelId
 *                   itself for catalog-less providers / free-text / removed ids).
 *                   Display-only — never sent back in the PUT request.
 *               providerOptions:
 *                 type: object
 *                 description: Provider-namespaced options (e.g. {"openai":{...}}).
 *               isDefault:
 *                 type: boolean
 *                 description: Whether this entry is the default model.
 *         useOnlyEnvVars:
 *           type: boolean
 *           description: When true (env:useOnlyEnvVars:ai), provider connection settings are fixed by env vars and read-only.
 *         isConfigured:
 *           type: boolean
 *           description: Whether at least one available provider has at least one allowed model (isAiConfigured()).
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
 *        description: Get the currently effective AI settings. No API key value is ever returned (only isApiKeySet).
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
 * Build the status of a single provider for the admin UI.
 *
 * The API key value is never read into a returned field — only its presence is
 * exposed via `isApiKeySet` (Req 1.8, 1.9). `azureOpenaiSettings` is carried only
 * by the 'azure-openai' entry (it is non-secret); the other three omit it.
 */
const buildProviderStatus = (provider: AiProvider): AiProviderStatus => {
  const settings = getProviderSettings(provider);
  const apiKey = getApiKey(provider);

  const status: AiProviderStatus = {
    enabled: settings?.enabled === true,
    // getApiKey already normalizes a blank / whitespace-only key to undefined, so a
    // present value here is a usable key — this flag cannot disagree with the
    // availability rule, which reads the same accessor.
    isApiKeySet: apiKey != null,
  };

  if (provider === 'azure-openai') {
    return { ...status, azureOpenaiSettings: settings?.azureOpenaiSettings };
  }
  return status;
};

/**
 * GET /_api/v3/ai-settings handler.
 *
 * Returns the currently effective multi-provider AI configuration for the admin
 * UI. `providers` is a fixed-slot Record over ALL supported providers (iterated
 * from the declared `AI_PROVIDERS` set, never hard-coded): an unconfigured
 * provider is returned as a disabled entry, never omitted (Req 1.1). The
 * per-provider status and the allow-list are read through the ai-sdk-modules
 * accessors, which already apply defensive shape guards and the masking
 * discipline, so no raw config is re-read here.
 *
 * No API key value is ever returned — only the per-provider `isApiKeySet`
 * (Req 1.8, 1.9). The boolean flags let the UI decide editability
 * (`useOnlyEnvVars`) and whether to show the "enabled but not configured"
 * warning (`isConfigured`).
 *
 * Middleware (scope + login + adminRequired) is composed in `getAiSettingsFactory`
 * below, so this is a plain terminal handler that reads config and shapes the response.
 */
export const getAiSettings = async (
  _req: Request,
  res: ApiV3Response,
): Promise<void> => {
  try {
    const providers = mapProviders(buildProviderStatus);

    // The cross-provider allow-list (incl. isDefault and providerOptions).
    // getAllowedModels() always returns an array (Req 1.1). The admin UI is
    // trusted, so providerOptions ARE exposed here (unlike the chat /models
    // endpoint, which omits them).
    const allowedModels = getAllowedModels();

    // Enrich each entry with its official display name from the effective
    // catalog (id fallback), so the settings UI can render names without a
    // second lookup. Display-only: the PUT request never carries displayName.
    const resolveDisplayName = await buildModelDisplayNameResolver(
      allowedModels.map((m) => m.provider),
    );

    const response: AiSettingsResponse = {
      aiEnabled: configManager.getConfig('app:aiEnabled'),
      providers,
      allowedModels: allowedModels.map((m) => ({
        ...m,
        displayName: resolveDisplayName(m.provider, m.modelId),
      })),
      useOnlyEnvVars: configManager.getConfig('env:useOnlyEnvVars:ai') === true,
      isConfigured: isAiConfigured(),
    };

    res.apiv3(response);
  } catch (err) {
    // Log without any key material: the caught error originates from config reads,
    // the masking accessors, or isAiConfigured(), none of which carry the secret
    // key value — so it must never reach logs or the client (Req 1.9).
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
