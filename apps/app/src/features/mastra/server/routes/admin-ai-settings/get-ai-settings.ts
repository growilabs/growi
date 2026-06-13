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
 * GET /_api/v3/ai-settings handler.
 *
 * Returns the currently effective AI configuration for the admin UI. Each value
 * comes from `configManager.getConfig`, which already resolves env-only mode, so
 * the response reflects what the runtime actually uses (Req 1.4, 4.4).
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

    const response: AiSettingsResponse = {
      aiEnabled: configManager.getConfig('app:aiEnabled'),
      provider: configManager.getConfig('ai:provider'),
      model: configManager.getConfig('ai:model'),
      providerOptions: configManager.getConfig('ai:providerOptions'),
      azureOpenaiResourceName: configManager.getConfig(
        'ai:azureOpenaiResourceName',
      ),
      azureOpenaiBaseUrl: configManager.getConfig('ai:azureOpenaiBaseUrl'),
      azureOpenaiApiVersion: configManager.getConfig(
        'ai:azureOpenaiApiVersion',
      ),
      azureOpenaiUseEntraId: configManager.getConfig(
        'ai:azureOpenaiUseEntraId',
      ),
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
