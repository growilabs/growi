import type { AiProvider } from './ai-provider';
import type { AllowedModel } from './allowed-model';
import type { AzureOpenaiConfig } from './azure-openai-config';

/**
 * GET /_api/v3/ai-settings response.
 *
 * Exposes the currently effective AI configuration to the admin UI. The
 * `ai:apiKey` value is never returned (only `isApiKeySet`), and the boolean
 * flags (`useOnlyEnvVars`, `isConfigured`) let the UI decide editability and
 * whether to surface the "enabled but not configured" warning.
 *
 * The Azure OpenAI connection settings are exposed as the same `AzureOpenaiConfig`
 * object used for storage (one canonical type end-to-end). It is always present
 * (an empty object when unset); `useEntraId` is optional (absent = false).
 */
export interface AiSettingsResponse {
  aiEnabled: boolean; // state of app:aiEnabled (7.1)
  provider?: AiProvider;
  allowedModels: AllowedModel[]; // per-model allow-list incl. isDefault; always an array (getAllowedModels() does `?? []`)
  azureOpenaiSettings: AzureOpenaiConfig;
  isApiKeySet: boolean; // the ai:apiKey value is never returned (5.2)
  useOnlyEnvVars: boolean; // when env:useOnlyEnvVars:ai is on, all fields are read-only (4.2)
  isConfigured: boolean; // result of isAiConfigured(), used for the 7.6 warning
}

/**
 * PUT /_api/v3/ai-settings request.
 *
 * Semantics are FULL-STATE REPLACE, not PATCH: the admin form always submits the
 * complete set of values, so an omitted *clearable* field (`provider`,
 * `allowedModels`) is treated as "cleared" — it is removed from the DB and the
 * effective value falls back to its env var (Req 4.4). A partial request that omits
 * these will therefore RESET them; an API client must send the complete set, not
 * just the fields it wants changed.
 *
 * `apiKey` is the one merge EXCEPTION (omit = keep the current value): an empty or
 * omitted value keeps the existing stored key; it is never cleared by this
 * request. A new key is applied only when a non-empty string is sent (Req 5.x).
 *
 * `azureOpenaiSettings` is the same `AzureOpenaiConfig` object used for storage.
 * It is a single FULL-STATE-REPLACE unit: each inner string is clearable
 * (empty/omit = reset that field) and `useEntraId` is part of the same object
 * (not an independent merge field) — the whole object is replaced, so unchecking
 * Entra ID or clearing one field is honored exactly as submitted, and clearing
 * every field resets the entire object to its env default.
 *
 * Every field is typed optional so the exceptions above can be omitted — this is
 * NOT an invitation to send a partial set of the clearable fields expecting the
 * rest to survive (they will be reset to their env defaults).
 */
export interface AiSettingsUpdateRequest {
  aiEnabled?: boolean; // merge: applied only when provided; omit = keep (7.1)
  provider?: AiProvider; // clearable: omit = reset to env default (4.4)
  apiKey?: string; // merge: empty/omitted keeps the existing value (5.x)
  allowedModels?: AllowedModel[]; // full-state-replace; empty/omit = clear (resets ai:allowedModels to its env default)
  azureOpenaiSettings?: AzureOpenaiConfig; // full-state-replace object (see note above)
}

/**
 * The config keys this feature manages: the AI enablement toggle plus the 4
 * `ai:*` settings (the per-model allow-list is one `ai:allowedModels` object array,
 * and the Azure OpenAI connection config is one `ai:azureOpenaiSettings` JSON object).
 * It mirrors the env-only group declared in config-definition
 * (`env:useOnlyEnvVars:ai`). Keep this in sync with that group.
 */
export const AI_SETTING_KEYS = [
  'app:aiEnabled',
  'ai:provider',
  'ai:apiKey',
  'ai:allowedModels',
  'ai:azureOpenaiSettings',
] as const;
