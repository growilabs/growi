import { ErrorV3 } from '@growi/core/dist/models';
import type { Request } from 'express';

import { isAiConfigured } from '~/features/mastra/server/services/is-ai-configured';
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
 * Middleware (scope + adminRequired) is attached by the router (task 3.4), so this
 * is a plain handler that reads config and shapes the response.
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
