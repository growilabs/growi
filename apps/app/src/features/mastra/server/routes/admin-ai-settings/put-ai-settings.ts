import { ErrorV3 } from '@growi/core/dist/models';

import { clearResolvedMastraModelCache } from '~/features/mastra/server/services/ai-sdk-modules/resolve-mastra-model';
import { SupportedAction } from '~/interfaces/activity';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import type { AiSettingsUpdateRequest } from '../../../interfaces/ai-settings';

const logger = loggerFactory(
  'growi:features:mastra:routes:admin-ai-settings:put-ai-settings',
);

// The exact updates shape accepted by configManager.updateConfigs, derived from
// the public instance so the internal ConfigKey/ConfigValues types stay behind
// the config-manager module boundary.
type AiConfigUpdates = Parameters<typeof configManager.updateConfigs>[0];

/**
 * Normalize an optional string field for persistence: an empty string means
 * "cleared", which becomes `undefined` so that `updateConfigs({ removeIfUndefined })`
 * deletes the DB value and the effective value falls back to the env var (Req 4.4).
 * The generic preserves the field's narrowed type (e.g. AiProvider) instead of
 * widening it to `string`.
 */
const normalizeStringField = <T extends string>(
  value: T | undefined,
): T | undefined => (value === '' ? undefined : value);

/**
 * Build the config updates from a validated request body.
 *
 * Update semantics (design "API Contract"):
 *   - string fields are normalized ('' -> undefined) and ALWAYS placed in the
 *     object so `removeIfUndefined` removes the cleared ones (Req 4.4)
 *   - boolean fields are always saved when provided (toggle / Entra ID)
 *   - `ai:apiKey` is the exception: included only when a non-empty string is
 *     sent, so an empty/omitted apiKey preserves the existing stored key (Req 5.x).
 *     Because the key is simply absent from the updates object in that case,
 *     `removeIfUndefined` never touches it.
 */
const buildUpdates = (body: AiSettingsUpdateRequest): AiConfigUpdates => {
  const updates: AiConfigUpdates = {
    'ai:provider': normalizeStringField(body.provider),
    'ai:model': normalizeStringField(body.model),
    'ai:providerOptions': normalizeStringField(body.providerOptions),
    'ai:azureOpenaiResourceName': normalizeStringField(
      body.azureOpenaiResourceName,
    ),
    'ai:azureOpenaiBaseUrl': normalizeStringField(body.azureOpenaiBaseUrl),
    'ai:azureOpenaiApiVersion': normalizeStringField(
      body.azureOpenaiApiVersion,
    ),
  };

  if (body.aiEnabled != null) {
    updates['app:aiEnabled'] = body.aiEnabled;
  }
  if (body.azureOpenaiUseEntraId != null) {
    updates['ai:azureOpenaiUseEntraId'] = body.azureOpenaiUseEntraId;
  }

  // Only persist the apiKey when a non-empty value is provided; otherwise omit
  // it entirely so the existing stored key is preserved (never cleared).
  if (typeof body.apiKey === 'string' && body.apiKey !== '') {
    updates['ai:apiKey'] = body.apiKey;
  }

  return updates;
};

/**
 * PUT /_api/v3/ai-settings handler factory.
 *
 * Persists the submitted AI configuration after validation. Middleware (scope +
 * adminRequired + addActivity + the validator chain + apiV3FormValidator) is
 * attached by the router (task 3.4); this factory only needs `crowi` to obtain
 * the activity event emitter, so it is exported as a factory to match how the
 * router wires its dependencies.
 *
 * Behavior:
 *   - When env-only mode is active (`env:useOnlyEnvVars:ai` === true), the update
 *     is rejected with 422 and nothing is persisted (Req 4.3).
 *   - On success the config is written, the resolved-model cache is invalidated
 *     for restart-free reflection (Req 2.4), and an audit event is emitted (Req 2.3).
 *   - Errors never carry the apiKey to the message, the log, or the client (Req 5.3).
 */
export const putAiSettingsFactory = (crowi: Crowi) => {
  const activityEvent = crowi.events.activity;

  return async (req: CrowiRequest, res: ApiV3Response): Promise<void> => {
    // Defense-in-depth: env-only mode fixes AI settings to env values, so reject
    // the update explicitly even though getConfig would ignore the DB value (Req 4.3).
    if (configManager.getConfig('env:useOnlyEnvVars:ai') === true) {
      res.apiv3Err(
        new ErrorV3(
          'Updating AI settings is prohibited on this system.',
          'update-aiSettings-prohibited',
        ),
        422,
      );
      return;
    }

    const body: AiSettingsUpdateRequest = req.body;
    const updates = buildUpdates(body);

    try {
      // removeIfUndefined deletes cleared string fields from the DB so they fall
      // back to their env vars; apiKey is absent from `updates` when not set, so
      // this option never clears the stored key (Req 4.4 / 5.x).
      await configManager.updateConfigs(updates, { removeIfUndefined: true });

      // Invalidate the memoized model so the next AI request rebuilds it from the
      // new config without a server restart (Req 2.4).
      clearResolvedMastraModelCache();

      activityEvent.emit('update', res.locals.activity._id, {
        action: SupportedAction.ACTION_ADMIN_AI_SETTING_UPDATE,
      });

      res.apiv3({});
    } catch (err) {
      // Log without the request body: it may contain ai:apiKey, which must never
      // reach the logs or the client error message (Req 5.3).
      logger.error('Failed to update AI settings', err);
      res.apiv3Err(new ErrorV3('Failed to update AI settings'), 500);
    }
  };
};
