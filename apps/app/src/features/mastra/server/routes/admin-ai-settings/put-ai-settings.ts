import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';
import { body, type ValidationChain } from 'express-validator';

import type { AiProvider } from '~/features/mastra/interfaces/ai-provider';
import { isAiProvider } from '~/features/mastra/interfaces/ai-provider';
import { clearResolvedMastraModelCache } from '~/features/mastra/server/services/ai-sdk-modules/resolved-model-cache';
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
import type { AllowedModel } from '../../../interfaces/allowed-model';
import type { AzureOpenaiConfig } from '../../../interfaces/azure-openai-config';
import { isValidAllowedModelsRequest } from './validate-allowed-models';

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
 *         allowedModels:
 *           type: array
 *           description: >-
 *             The per-model allow-list (full-state replace). When non-empty, every
 *             entry needs a non-empty unique model id and exactly one entry must be
 *             the default; an empty array (or omitting the field) clears the list
 *             (resets ai:allowedModels to its env default). Validated as a whole.
 *           items:
 *             type: object
 *             required: [modelId]
 *             properties:
 *               modelId:
 *                 type: string
 *                 description: The model id (deployment name for Azure OpenAI).
 *               providerOptions:
 *                 type: object
 *                 description: Provider-namespaced options (e.g. {"openai":{...}}); omit for no options.
 *               isDefault:
 *                 type: boolean
 *                 description: Marks the default entry. Exactly one entry must set this true.
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
 * omit semantics (omitted clearable fields are reset; apiKey/booleans are merge
 * exceptions). provider must be a supported AI provider; `allowedModels` (when
 * non-empty) must satisfy the per-model allow-list invariants (Req 1.3/1.4/1.5/2.4)
 * while an empty array is accepted as the clear path (Req 1.1); the boolean toggles
 * must be real booleans. Semantic option validity is the provider integration's
 * responsibility.
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
  // allowedModels: the per-model allow-list (full-state replace). A SINGLE .custom()
  // enforces the whole-array contract via the shared pure predicate
  // (isValidAllowedModelsRequest), so the cross-field rules (no duplicate ids,
  // exactly one isDefault) and the per-entry rules (non-empty model, valid
  // provider-namespaced providerOptions) are checked together — express-validator's
  // per-field chains cannot express those array invariants. An EMPTY array is
  // ACCEPTED here (the clear path, Req 1.1): the isDefault-uniqueness rule applies
  // only to a non-empty list, so a legitimate "no models" disablement is never a
  // 422. A non-array, a non-empty list with an empty/duplicate model id, an invalid
  // providerOptions value, or an isDefault count != 1 is rejected (Req 1.3/1.4/1.5/2.4).
  body('allowedModels')
    .optional()
    .custom((value: unknown) => isValidAllowedModelsRequest(value))
    .withMessage(
      'allowedModels must be an array; each entry needs a non-empty unique model id, valid provider-namespaced providerOptions, and exactly one entry must be the default',
    ),

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
 * Resolve the `ai:allowedModels` config value from a validated request.
 *
 * FULL-STATE REPLACE with a CLEAR path that mirrors `buildAzureOpenaiConfig`: when the
 * request omits `allowedModels` or sends an EMPTY array, the value collapses to
 * `undefined` so `updateConfigs({ removeIfUndefined: true })` deletes the key — then
 * `getConfig('ai:allowedModels')` falls back to its default `[]` (or the
 * `AI_ALLOWED_MODELS` env value). An empty array is a legitimate "no allowed models"
 * disablement, NOT a validation error (the validator accepts it; see design "空配列 /
 * 未指定の扱い（クリア経路）"). A non-empty array — already verified by the validator —
 * is persisted verbatim (incl. isDefault and providerOptions, Req 1.1/1.3).
 */
const buildAllowedModels = (
  body: AiSettingsUpdateRequest,
): AllowedModel[] | undefined => {
  const models = body.allowedModels;
  return models != null && models.length > 0 ? models : undefined;
};

/**
 * Build the config updates from a validated request body.
 *
 * Update semantics (design "API Contract"): FULL-STATE REPLACE, not PATCH.
 *   - `provider` is a clearable string already normalized ('' -> undefined) by the
 *     validator's customSanitizer (middleware that runs before this handler), so it
 *     is mapped directly and ALWAYS placed in the object — `removeIfUndefined` then
 *     removes it when cleared so the value falls back to its env default (Req 4.4).
 *     A field the request OMITTED is `undefined` here too and is likewise removed.
 *     Callers must send the complete set (the admin form always does); see
 *     AiSettingsUpdateRequest.
 *   - `allowedModels` is the per-model allow-list, resolved by buildAllowedModels:
 *     a non-empty (validated) array is persisted verbatim; an empty/omitted array
 *     collapses to `undefined` (the clear path) so removeIfUndefined deletes the key
 *     and getConfig falls back to `[]` (Req 1.1) — same collapse shape as Azure.
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
    'ai:allowedModels': buildAllowedModels(body),
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
