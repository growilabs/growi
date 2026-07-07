import { isNonBlankString, SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';
import { body, type ValidationChain } from 'express-validator';

import type { AiProvider } from '~/features/mastra/interfaces/ai-provider';
import { AI_PROVIDERS } from '~/features/mastra/interfaces/ai-provider';
import { clearResolvedMastraModelCache } from '~/features/mastra/server/services/ai-sdk-modules/resolve-mastra-model';
import { isRecord } from '~/features/mastra/utils/is-record';
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

import type {
  AiProviderUpdateRequest,
  AiSettingsUpdateRequest,
} from '../../../interfaces/ai-settings';
import type { AzureOpenaiConfig } from '../../../interfaces/azure-openai-config';
import type {
  AiProviderApiKeys,
  AiProvidersConfig,
} from '../../../interfaces/provider-settings';
import { readProviderApiKeys } from '../../services/ai-sdk-modules/llm-providers/config';
import { clearAvailabilityLogDedup } from '../../services/ai-sdk-modules/llm-providers/warn-dedup';
import { isValidAllowedModelsRequest } from './validate-allowed-models';

const logger = loggerFactory(
  'growi:features:mastra:routes:admin-ai-settings:put-ai-settings',
);

/**
 * @swagger
 *
 * components:
 *   schemas:
 *     AiProviderUpdateRequest:
 *       description: >-
 *         Per-provider section of the PUT request. Full-state replace (`enabled`
 *         omitted = false) with one merge exception: `apiKey` is write-only — an
 *         empty or omitted value keeps the stored key (there is no clear operation),
 *         and a new key is applied only when a non-empty string is sent (Req 1.4).
 *       type: object
 *       properties:
 *         enabled:
 *           type: boolean
 *           description: Whether the provider is toggled on. Omitted = false.
 *         apiKey:
 *           type: string
 *           description: >-
 *             Write-only; never returned by GET. Empty or omitted keeps the stored
 *             key; a non-empty value overwrites it. Keys are never cleared.
 *         azureOpenaiSettings:
 *           type: object
 *           description: Azure OpenAI connection settings — only meaningful for the 'azure-openai' entry (full-state replace).
 *           properties:
 *             resourceName:
 *               type: string
 *             baseURL:
 *               type: string
 *             apiVersion:
 *               type: string
 *             useEntraId:
 *               type: boolean
 *     AiSettingsUpdateRequest:
 *       description: >-
 *         Each top-level section (aiEnabled / providers / allowedModels) is OMIT =
 *         LEAVE UNCHANGED; a present section is a full-state replace of that section.
 *         When `providers` is present it MUST carry an entry for every supported
 *         provider (fixed-slot model). An empty `allowedModels` array is accepted and
 *         stored as "no allowed models" (Req 3.3). In env-only mode a request
 *         containing `providers` or `aiEnabled` is rejected with 400; only
 *         `allowedModels` is editable (Req 5.2, 5.3).
 *       type: object
 *       properties:
 *         aiEnabled:
 *           type: boolean
 *           description: Toggle for app:aiEnabled. Omit = unchanged.
 *         providers:
 *           type: object
 *           description: >-
 *             Per-provider update sections keyed by provider (openai, anthropic,
 *             google, azure-openai). Omit = unchanged; when present, all four entries
 *             are required.
 *           additionalProperties:
 *             $ref: '#/components/schemas/AiProviderUpdateRequest'
 *         allowedModels:
 *           type: array
 *           description: >-
 *             The cross-provider allow-list (full-state replace). Omit = unchanged;
 *             an empty array is stored as "no allowed models". When non-empty, every
 *             entry needs a supported provider, a non-empty unique (provider, modelId)
 *             pair, and exactly one entry must be the default.
 *           items:
 *             type: object
 *             required: [provider, modelId]
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [openai, anthropic, google, azure-openai]
 *               modelId:
 *                 type: string
 *                 description: The model id (deployment name for Azure OpenAI).
 *               providerOptions:
 *                 type: object
 *                 description: Provider-namespaced options (e.g. {"openai":{...}}); omit for no options.
 *               isDefault:
 *                 type: boolean
 *                 description: Marks the default entry. Exactly one entry must set this true.
 */

// The Azure connection strings are optional strings; a non-string is rejected.
const isOptionalString = (value: unknown): boolean =>
  value == null || typeof value === 'string';

// The nested azureOpenaiSettings object: each connection string is optional (string),
// useEntraId optional boolean. Any wrong-typed field fails validation.
const isValidAzureSettingsRequest = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }
  if (
    !isOptionalString(value.resourceName) ||
    !isOptionalString(value.baseURL) ||
    !isOptionalString(value.apiVersion)
  ) {
    return false;
  }
  return value.useEntraId == null || typeof value.useEntraId === 'boolean';
};

// A single provider's update section: optional enabled (boolean), optional apiKey
// (string), optional azureOpenaiSettings (object with valid inner fields).
const isValidProviderEntryRequest = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }
  if (value.enabled != null && typeof value.enabled !== 'boolean') {
    return false;
  }
  if (value.apiKey != null && typeof value.apiKey !== 'string') {
    return false;
  }
  if (
    value.azureOpenaiSettings != null &&
    !isValidAzureSettingsRequest(value.azureOpenaiSettings)
  ) {
    return false;
  }
  return true;
};

/**
 * True when `value` is a well-formed `providers` payload. The key new rule: a
 * present `providers` object MUST carry an entry for EVERY supported provider
 * (design "a providers request must include all 4 provider entries"). Iterating the
 * declared `AI_PROVIDERS` set (not a hard-coded list) keeps this in sync with the
 * fixed-slot model — adding a provider needs no change here. Each entry is
 * shape-checked (enabled/apiKey/azureOpenaiSettings types). `value` is `unknown`
 * because the payload is client-supplied JSON.
 */
const isValidProvidersRequest = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }
  return AI_PROVIDERS.every((provider) =>
    isValidProviderEntryRequest(value[provider]),
  );
};

/**
 * express-validator chain for PUT /_api/v3/ai-settings (formal validation).
 *
 * Every field is optional at the validation layer, but each present section is a
 * FULL-STATE REPLACE (see the `AiSettingsUpdateRequest` contract). `providers`,
 * when present, must carry all four provider entries; `allowedModels` (when
 * non-empty) must satisfy the per-model allow-list invariants (unique
 * (provider, modelId), supported provider, exactly one default), while an empty
 * array is accepted as the "no allowed models" state. Validation failures surface
 * as 400 via apiV3FormValidator.
 */
export const updateAiSettingsValidators: ValidationChain[] = [
  body('aiEnabled')
    .optional()
    .isBoolean()
    .withMessage('aiEnabled must be a boolean'),
  // providers is validated as a WHOLE object: the fixed-slot completeness rule
  // (all four provider entries required) cannot be expressed by per-field chains.
  body('providers')
    .optional()
    .custom((value: unknown) => isValidProvidersRequest(value))
    .withMessage(
      'providers must be an object with an entry for every supported provider (openai, anthropic, google, azure-openai); each entry may set enabled (boolean), apiKey (string), and azureOpenaiSettings (object)',
    ),
  // allowedModels is validated as a WHOLE array (per-entry + cross-field invariants
  // cannot be expressed by per-field chains). An EMPTY array is accepted (the clear
  // path, Req 3.3); a non-array, a duplicate (provider, modelId), an unsupported
  // provider, an empty model id, invalid providerOptions, or an isDefault count != 1
  // is rejected (Req 2.3/2.4/2.5/3.2).
  body('allowedModels')
    .optional()
    .custom((value: unknown) => isValidAllowedModelsRequest(value))
    .withMessage(
      'allowedModels must be an array; each entry needs a supported provider, a non-empty unique (provider, modelId) pair, valid provider-namespaced providerOptions, and exactly one entry must be the default',
    ),
];

// The exact updates shape accepted by configManager.updateConfigs, derived from
// the public instance so the internal ConfigKey/ConfigValues types stay behind
// the config-manager module boundary.
type AiConfigUpdates = Parameters<typeof configManager.updateConfigs>[0];

/**
 * Re-assemble one provider's `azureOpenaiSettings` config value as FULL-STATE
 * REPLACE: a cleared/empty string is omitted, `useEntraId` is kept only when
 * explicitly true (its default-false carries no information), and an object with no
 * meaningful content collapses to `undefined` so it is not stored at all. Only the
 * 'azure-openai' entry carries this object.
 */
const buildAzureOpenaiConfig = (
  settings: AzureOpenaiConfig | undefined,
): AzureOpenaiConfig | undefined => {
  if (settings == null) {
    return undefined;
  }
  const isNonEmpty = (value: string | undefined): value is string =>
    value != null && value !== '';

  const azureOpenaiSettings: AzureOpenaiConfig = {
    ...(isNonEmpty(settings.resourceName)
      ? { resourceName: settings.resourceName }
      : {}),
    ...(isNonEmpty(settings.baseURL) ? { baseURL: settings.baseURL } : {}),
    ...(isNonEmpty(settings.apiVersion)
      ? { apiVersion: settings.apiVersion }
      : {}),
    ...(settings.useEntraId === true ? { useEntraId: true } : {}),
  };

  return Object.keys(azureOpenaiSettings).length > 0
    ? azureOpenaiSettings
    : undefined;
};

/**
 * Build the non-secret `ai:providers` config value from a validated `providers`
 * request (full-state replace over ALL four providers). Each entry stores its
 * `enabled` flag (omitted request flag = false), and the 'azure-openai' entry
 * additionally stores its connection settings. API keys are NOT stored here — they
 * live in the separate secret `ai:providerApiKeys` key (Req 1.6: disabling a
 * provider here never touches its stored key or, for azure, is re-sent by the form).
 */
const buildProvidersConfig = (
  providers: Record<AiProvider, AiProviderUpdateRequest>,
): AiProvidersConfig => {
  const config: AiProvidersConfig = {};
  for (const provider of AI_PROVIDERS) {
    const entry = providers[provider];
    const azureOpenaiSettings =
      provider === 'azure-openai'
        ? buildAzureOpenaiConfig(entry.azureOpenaiSettings)
        : undefined;
    config[provider] = {
      enabled: entry.enabled === true,
      ...(azureOpenaiSettings != null ? { azureOpenaiSettings } : {}),
    };
  }
  return config;
};

/**
 * Collect the NON-EMPTY API keys from a validated `providers` request, keyed by
 * provider. Empty/omitted keys are dropped (the merge exception: they keep the
 * stored value, Req 1.4). The result is used only when it is non-empty.
 */
const collectRequestApiKeys = (
  providers: Record<AiProvider, AiProviderUpdateRequest>,
): AiProviderApiKeys => {
  const keys: AiProviderApiKeys = {};
  for (const provider of AI_PROVIDERS) {
    const apiKey = providers[provider].apiKey;
    // Treat a blank / whitespace-only value as "not provided" (the merge exception:
    // keep the stored key), via the shared `isNonBlankString` (the one blank rule,
    // matching the read side). Persist the TRIMMED value so a key pasted with
    // surrounding whitespace is not stored verbatim (which would read back as
    // configured yet fail at the provider with a 401 / invalid-header error).
    if (isNonBlankString(apiKey)) {
      keys[provider] = apiKey.trim();
    }
  }
  return keys;
};

/**
 * Build the config updates from a validated request body.
 *
 * Update semantics (design "PUT semantics"): each top-level section is
 * OMIT = DO NOT WRITE THE KEY; a present section is written as a concrete value:
 *   - `app:aiEnabled` — written only when `aiEnabled` is provided (merge: omit keeps it).
 *   - `ai:providers` — written only when `providers` is provided; a full-state
 *     replace over all four providers (enabled flag + azure settings), NON-secret.
 *   - `ai:allowedModels` — written only when `allowedModels` is provided; stored
 *     VERBATIM, including an empty `[]` ("no allowed models", Req 3.3) — never
 *     collapsed to a key deletion / env fallback.
 *   - `ai:providerApiKeys` — the SECRET merge exception. Collect the request's
 *     non-empty keys; if there are NONE, the key is left OUT of `updates` entirely
 *     so a toggle/model-only save never duplicates an env-provided key into the DB.
 *     When there is at least one, read the CURRENT merged (DB ?? env) view at SAVE
 *     time and overwrite it with the request keys — carrying forward keys for
 *     providers not in this request (incl. env-derived ones, Req 1.3/1.4) and never
 *     clearing (overwrite-only).
 *
 * SECRET DISCIPLINE (Req 1.9): no key value is logged; keys are only ever read from
 * the merged view and written back.
 */
const buildUpdates = (body: AiSettingsUpdateRequest): AiConfigUpdates => {
  const updates: AiConfigUpdates = {};

  if (body.aiEnabled != null) {
    updates['app:aiEnabled'] = body.aiEnabled;
  }

  if (body.providers != null) {
    updates['ai:providers'] = buildProvidersConfig(body.providers);
  }

  if (body.allowedModels != null) {
    // Verbatim full-state replace, INCLUDING an empty array (stored as [], Req 3.3).
    updates['ai:allowedModels'] = body.allowedModels;
  }

  const requestApiKeys =
    body.providers != null ? collectRequestApiKeys(body.providers) : {};
  if (Object.keys(requestApiKeys).length > 0) {
    // Read the CURRENT merged (DB ?? env) view at SAVE time — the same view GET's
    // isApiKeySet reflects — never a GET snapshot or the request. This preserves
    // keys for providers not in this request (incl. env-derived) and never clears.
    // Use the SHAPE-GUARDED accessor (not raw getConfig): a malformed but valid-JSON
    // config (array/string) reads as unset here instead of being spread into
    // index-keyed junk and persisted alongside the real keys.
    const current = readProviderApiKeys() ?? {};
    const merged: AiProviderApiKeys = { ...current, ...requestApiKeys };
    updates['ai:providerApiKeys'] = merged;
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
 *          Update the AI settings. Each top-level section (aiEnabled / providers /
 *          allowedModels) is omit = leave unchanged; a present section is a
 *          full-state replace. In env-only mode (env:useOnlyEnvVars:ai) a request
 *          that contains providers or aiEnabled is rejected with 400 (connection
 *          settings are env-only); only allowedModels stays editable.
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
 *            description: Validation failed, or a connection-setting change was attempted while env-only mode is active.
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
 *   - env-only split (Req 5.2/5.3): when `env:useOnlyEnvVars:ai` is true, a request
 *     that contains `providers` or `aiEnabled` is rejected with 400 and nothing is
 *     persisted (connection settings are env-only); an allowedModels-only request
 *     still proceeds (model settings stay editable).
 *   - On success the config is written, the resolved-model cache is invalidated and
 *     the availability-log dedup is reset (restart-free reflection + re-notification
 *     of any remaining misconfiguration), and an audit event is emitted.
 *   - Errors never carry an apiKey value to the message, the log, or the client (Req 1.9).
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
    const body: AiSettingsUpdateRequest = req.body;

    // env-only mode fixes the provider connection settings (and the AI toggle) to
    // env vars and makes them read-only; only allowedModels stays editable (Req
    // 5.2/5.3). Reject a connection-setting change explicitly with 400 and persist
    // nothing.
    if (
      configManager.getConfig('env:useOnlyEnvVars:ai') === true &&
      (body.providers != null || body.aiEnabled != null)
    ) {
      res.apiv3Err(
        new ErrorV3(
          'AI provider connection settings can only be changed via environment variables in this system.',
          'update-aiSettings-connection-env-only',
        ),
        400,
      );
      return;
    }

    const updates = buildUpdates(body);

    try {
      await configManager.updateConfigs(updates);

      // Invalidate the memoized model AND reset the availability/malformed-config
      // log dedup so the next request rebuilds from the new config and re-notifies
      // any remaining misconfiguration — all without a server restart.
      clearResolvedMastraModelCache();
      clearAvailabilityLogDedup();

      activityEvent.emit('update', res.locals.activity._id, {
        action: SupportedAction.ACTION_ADMIN_AI_SETTING_UPDATE,
      });

      res.apiv3({});
    } catch (err) {
      // Log without the request body: it may contain provider API keys, which must
      // never reach the logs or the client error message (Req 1.9).
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
