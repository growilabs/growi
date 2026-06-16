import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';
import { body, type ValidationChain } from 'express-validator';

import type { AiProvider } from '~/features/mastra/interfaces/ai-provider';
import { isAiProvider } from '~/features/mastra/interfaces/ai-provider';
import { clearResolvedMastraModelCache } from '~/features/mastra/server/services/ai-sdk-modules/resolve-mastra-model';
import { SupportedAction } from '~/interfaces/activity';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import type { AiSettingsUpdateRequest } from '../../../interfaces/ai-settings';
import type { AzureOpenaiConfig } from '../../../interfaces/azure-openai-config';
import { isValidProviderOptionsJson } from '../../../utils/provider-options-validation';

const logger = loggerFactory(
  'growi:features:mastra:routes:admin-ai-settings:put-ai-settings',
);

/**
 * @swagger
 *
 * components:
 *   schemas:
 *     AiSettingsUpdateRequest:
 *       description: >-
 *         Full-state replace (NOT a PATCH): an omitted clearable string field is
 *         reset to its env default. apiKey (empty/omitted keeps the existing key)
 *         and the booleans (applied only when provided) are the merge exceptions.
 *       type: object
 *       properties:
 *         aiEnabled:
 *           type: boolean
 *           description: Toggle for app:aiEnabled. Applied only when provided; omit keeps the current value.
 *         provider:
 *           type: string
 *           enum: [openai, anthropic, google, azure-openai]
 *           description: Clearable — omit resets to the env default.
 *         apiKey:
 *           type: string
 *           description: >-
 *             Write-only; never returned by GET. Empty or omitted keeps the
 *             existing stored key ONLY when the provider is unchanged. If the
 *             provider changes and no new key is supplied, the stored key is
 *             cleared so it is not reused against (and sent to) the new provider.
 *         model:
 *           type: string
 *           description: Clearable — omit resets to the env default.
 *         providerOptions:
 *           type: string
 *           description: Provider-namespaced options as a raw JSON string. Clearable — omit resets to the env default.
 *         azureOpenaiSettings:
 *           type: object
 *           description: >-
 *             Azure OpenAI connection settings, replaced as a whole (full-state).
 *             Each inner string is clearable (empty/omit = reset that field), and
 *             clearing every field resets the whole object to the env default.
 *           properties:
 *             resourceName:
 *               type: string
 *             baseURL:
 *               type: string
 *             apiVersion:
 *               type: string
 *             useEntraId:
 *               type: boolean
 *               description: Part of the object (full-state replace), not an independent merge field.
 */

/**
 * Optional config string that is cleared when empty: '' (or omitted) -> undefined
 * so updateConfigs({ removeIfUndefined }) deletes it and the value falls back to
 * the env var (Req 4.4). The customSanitizer (middleware) does the clearing, so the
 * handler no longer normalizes these fields itself.
 */
const clearableConfigString = (field: string): ValidationChain =>
  body(field)
    .optional()
    .isString()
    .withMessage(`${field} must be a string`)
    .customSanitizer((value) => (value === '' ? undefined : value));

/**
 * express-validator chain for PUT /_api/v3/ai-settings (formal validation, Req 6.1/6.2).
 * Every field is optional at the validation layer, but the request is a FULL-STATE
 * REPLACE rather than a PATCH — see the `AiSettingsUpdateRequest` contract for the
 * omit semantics (omitted clearable strings are reset; apiKey/booleans are merge
 * exceptions). provider must be a supported AI provider; the string fields are
 * type-guarded with .isString(); the clearable ones are sanitized ('' -> undefined)
 * so removeIfUndefined deletes them (Req 4.4); providerOptions must be valid JSON
 * when present; the boolean toggles must be real booleans. Semantic option validity
 * is the provider integration's responsibility.
 */
export const updateAiSettingsValidators: ValidationChain[] = [
  body('aiEnabled')
    .optional()
    .isBoolean()
    .withMessage('aiEnabled must be a boolean'),
  body('provider')
    .optional()
    .custom((value) => isAiProvider(value))
    .withMessage('provider must be one of the supported AI providers'),
  // apiKey is NOT cleared-when-empty (empty = keep existing, handled in buildUpdates),
  // so it only gets a type guard — NO ''->undefined sanitizer.
  body('apiKey').optional().isString().withMessage('apiKey must be a string'),
  clearableConfigString('model'),
  // providerOptions: validate the RAW value with the shared FE/BE predicate
  // (Req 6.2) BEFORE the sanitizer (the predicate treats '' as valid; sanitizing
  // first would feed it undefined). The sanitizer then clears '' -> undefined.
  body('providerOptions')
    .optional()
    .isString()
    .withMessage('providerOptions must be a string')
    .custom((value: string) => isValidProviderOptionsJson(value))
    .withMessage('providerOptions must be a valid JSON string')
    .customSanitizer((value) => (value === '' ? undefined : value)),

  // The Azure OpenAI connection settings are one nested object. Validate the
  // container, then each inner field by dot-path (the clearable strings reuse the
  // same '' -> undefined sanitizer so an emptied field is dropped from the object).
  body('azureOpenaiSettings')
    .optional()
    .isObject()
    .withMessage('azureOpenaiSettings must be an object'),
  clearableConfigString('azureOpenaiSettings.resourceName'),
  clearableConfigString('azureOpenaiSettings.baseURL'),
  clearableConfigString('azureOpenaiSettings.apiVersion'),
  body('azureOpenaiSettings.useEntraId')
    .optional()
    .isBoolean()
    .withMessage('azureOpenaiSettings.useEntraId must be a boolean'),
];

// The exact updates shape accepted by configManager.updateConfigs, derived from
// the public instance so the internal ConfigKey/ConfigValues types stay behind
// the config-manager module boundary.
type AiConfigUpdates = Parameters<typeof configManager.updateConfigs>[0];

/**
 * Re-assemble the `ai:azureOpenaiSettings` config value from a validated request.
 *
 * The request carries `azureOpenaiSettings` as the same nested AzureOpenaiConfig
 * object used for storage, and it is rebuilt here as FULL-STATE REPLACE (not
 * deep-merged with the env default): a cleared string field is already
 * '' -> undefined (validator sanitizer) and is therefore omitted, and `useEntraId`
 * is included only when explicitly true (its default-false carries no information).
 * When the assembled object has no keys at all — i.e. the admin cleared every field
 * and did not enable Entra ID — it collapses to `undefined` so removeIfUndefined
 * deletes the key and the value falls back to the AI_AZURE_OPENAI_SETTINGS env
 * default (Req 4.4, applied at the object level). Because the whole object is
 * replaced, unchecking Entra ID or clearing a single field is honored exactly as
 * submitted.
 */
const buildAzureOpenaiConfig = (
  body: AiSettingsUpdateRequest,
): AzureOpenaiConfig | undefined => {
  const settings = body.azureOpenaiSettings;
  const azureOpenaiSettings: AzureOpenaiConfig = {
    ...(settings?.resourceName != null
      ? { resourceName: settings.resourceName }
      : {}),
    ...(settings?.baseURL != null ? { baseURL: settings.baseURL } : {}),
    ...(settings?.apiVersion != null
      ? { apiVersion: settings.apiVersion }
      : {}),
    ...(settings?.useEntraId === true ? { useEntraId: true } : {}),
  };

  return Object.keys(azureOpenaiSettings).length > 0
    ? azureOpenaiSettings
    : undefined;
};

/**
 * Build the config updates from a validated request body.
 *
 * Update semantics (design "API Contract"): FULL-STATE REPLACE, not PATCH.
 *   - the clearable string fields (provider-common: model, providerOptions) are
 *     already normalized ('' -> undefined) by the validator's customSanitizer
 *     (middleware that runs before this handler), so they are mapped directly and
 *     ALWAYS placed in the object — `removeIfUndefined` then removes the cleared
 *     ones from the DB (Req 4.4). Consequently a field the request OMITTED is
 *     `undefined` here too and is likewise removed: an omitted clearable string is
 *     reset to its env default, not preserved. Callers must send the complete set
 *     (the admin form always does); see AiSettingsUpdateRequest.
 *   - the `azureOpenaiSettings` object is re-assembled into the `ai:azureOpenaiSettings`
 *     config value by buildAzureOpenaiConfig (see its note for the object-level
 *     full-state-replace + env-fallback semantics).
 *   - `app:aiEnabled` is saved only when provided (merge: omit keeps the toggle).
 *   - `ai:apiKey` is the exception: it has NO sanitizer, so it is included only
 *     when a non-empty string is sent; an empty/omitted apiKey normally preserves
 *     the existing stored key (Req 5.x). Because the key is simply absent from the
 *     updates object in that case, `removeIfUndefined` never touches it.
 *
 * SECURITY — apiKey must NOT survive a provider change. `ai:apiKey` is a single
 * key shared by every provider, so if the admin switches provider without
 * supplying a new key, the merge ("keep existing") would carry the previous
 * provider's secret over to the new one — and the next chat request would
 * transmit it to a different vendor's endpoint (e.g. an OpenAI key sent to
 * Google). To prevent this confused-deputy leak, when `provider` changes and no
 * new key is provided we clear the stored key (set it to undefined so
 * removeIfUndefined drops it); the admin must enter the new provider's key. The
 * convenience merge still applies for SAME-provider saves (e.g. changing only the
 * model). `currentProvider` is the value currently stored, read by the handler.
 */
const buildUpdates = (
  body: AiSettingsUpdateRequest,
  currentProvider: AiProvider | undefined,
): AiConfigUpdates => {
  const updates: AiConfigUpdates = {
    'ai:provider': body.provider,
    'ai:model': body.model,
    'ai:providerOptions': body.providerOptions,
    'ai:azureOpenaiSettings': buildAzureOpenaiConfig(body),
  };

  if (body.aiEnabled != null) {
    updates['app:aiEnabled'] = body.aiEnabled;
  }

  // apiKey resolution — maps to the SECURITY note in the JSDoc above:
  //   - non-empty key             -> persist it
  //   - no new key + provider CHANGED -> clear the stored key (undefined; removeIfUndefined drops it)
  //   - no new key + SAME provider    -> omit, preserving the stored key
  const hasNewApiKey = body.apiKey != null && body.apiKey !== '';
  if (hasNewApiKey) {
    updates['ai:apiKey'] = body.apiKey;
  } else if (body.provider !== currentProvider) {
    updates['ai:apiKey'] = undefined;
  }

  return updates;
};

/**
 * @swagger
 *
 *    /ai-settings:
 *      put:
 *        tags: [AiSettings]
 *        security:
 *          - bearer: []
 *          - accessTokenInQuery: []
 *          - accessTokenHeaderAuth: []
 *        summary: /ai-settings
 *        description: >-
 *          Update the AI settings (full-state replace). Rejected with 422 when
 *          env-only mode (env:useOnlyEnvVars:ai) is active.
 *        requestBody:
 *          required: true
 *          content:
 *            application/json:
 *              schema:
 *                $ref: '#/components/schemas/AiSettingsUpdateRequest'
 *        responses:
 *          200:
 *            description: AI settings updated.
 *          400:
 *            description: Validation failed (an invalid field value was sent).
 *          422:
 *            description: Updating AI settings is prohibited because env-only mode is active.
 *          500:
 *            description: Failed to update AI settings.
 */

/**
 * PUT /_api/v3/ai-settings handler factory.
 *
 * Returns the full middleware chain (scope gate + login + admin authorization +
 * addActivity + the validator chain + apiV3FormValidator + the terminal handler),
 * matching the mastra route convention where each handler factory owns its
 * middleware and the router just mounts the array. NO ai-ready guard is attached:
 * admins must reach this even while AI is disabled/unconfigured (Req 1).
 *
 * Terminal handler behavior:
 *   - When env-only mode is active (`env:useOnlyEnvVars:ai` === true), the update
 *     is rejected with 422 and nothing is persisted (Req 4.3).
 *   - On success the config is written, the resolved-model cache is invalidated
 *     for restart-free reflection (Req 2.4), and an audit event is emitted (Req 2.3).
 *   - Errors never carry the apiKey to the message, the log, or the client (Req 5.3).
 */
export const putAiSettingsFactory = (crowi: Crowi): RequestHandler[] => {
  const activityEvent = crowi.events.activity;

  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const adminRequired = adminRequiredFactory(crowi);
  const addActivity = generateAddActivityMiddleware();

  const handler = async (
    req: CrowiRequest,
    res: ApiV3Response,
  ): Promise<void> => {
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
    // Read the currently stored provider so buildUpdates can decide whether a
    // provider change must invalidate the shared apiKey (see its SECURITY note).
    const currentProvider = configManager.getConfig('ai:provider');
    const updates = buildUpdates(body, currentProvider);

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

  return [
    accessTokenParser([SCOPE.WRITE.ADMIN.AI], { acceptLegacy: true }),
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    ...updateAiSettingsValidators,
    apiV3FormValidator,
    handler,
  ];
};
