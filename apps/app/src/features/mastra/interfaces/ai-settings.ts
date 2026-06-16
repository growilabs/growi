import type { AiProvider } from './ai-provider';

/**
 * GET /_api/v3/ai-settings response.
 *
 * Exposes the currently effective AI configuration to the admin UI. The
 * `ai:apiKey` value is never returned (only `isApiKeySet`), and the boolean
 * flags (`useOnlyEnvVars`, `isConfigured`) let the UI decide editability and
 * whether to surface the "enabled but not configured" warning.
 */
export interface AiSettingsResponse {
  aiEnabled: boolean; // state of app:aiEnabled (7.1)
  provider?: AiProvider;
  model?: string;
  providerOptions?: string; // raw JSON string
  azureOpenaiResourceName?: string;
  azureOpenaiBaseUrl?: string;
  azureOpenaiApiVersion?: string;
  azureOpenaiUseEntraId: boolean;
  isApiKeySet: boolean; // the ai:apiKey value is never returned (5.2)
  useOnlyEnvVars: boolean; // when env:useOnlyEnvVars:ai is on, all fields are read-only (4.2)
  isConfigured: boolean; // result of isAiConfigured(), used for the 7.6 warning
}

/**
 * PUT /_api/v3/ai-settings request.
 *
 * Semantics are FULL-STATE REPLACE, not PATCH: the admin form always submits the
 * complete set of values, so an omitted *clearable string* field is treated as
 * "cleared" — it is removed from the DB and the effective value falls back to its
 * env var (Req 4.4). A partial request that omits these will therefore RESET them;
 * an API client must send the complete set, not just the fields it wants changed.
 *
 * `apiKey` is the one merge EXCEPTION (omit = keep the current value): an empty or
 * omitted value keeps the existing stored key; it is never cleared by this
 * request. A new key is applied only when a non-empty string is sent (Req 5.x).
 *
 * The four Azure OpenAI fields are persisted internally as ONE JSON object
 * (`ai:azureOpenaiSettings`); the request keeps them flat so the admin UI is unchanged.
 * They behave as a single FULL-STATE-REPLACE unit: the strings are clearable
 * (omit/empty = reset that field), and `azureOpenaiUseEntraId` is part of the same
 * object rather than an independent merge field — the whole object is replaced, so
 * unchecking Entra ID or clearing one field is honored exactly as submitted, and
 * clearing every field resets the entire object to its env default.
 *
 * Every field is typed optional so the exceptions above can be omitted — this is
 * NOT an invitation to send a partial set of the clearable strings expecting the
 * rest to survive (they will be reset to their env defaults).
 */
export interface AiSettingsUpdateRequest {
  aiEnabled?: boolean; // merge: applied only when provided; omit = keep (7.1)
  provider?: AiProvider; // clearable: omit = reset to env default (4.4)
  apiKey?: string; // merge: empty/omitted keeps the existing value (5.x)
  model?: string; // clearable: omit = reset to env default (4.4)
  providerOptions?: string; // clearable: omit = reset to env default (4.4)
  // The four flat fields below are consolidated into the ai:azureOpenaiSettings JSON
  // object as a single full-state-replace unit (see the contract note above).
  azureOpenaiResourceName?: string; // clearable: omit = reset to env default (4.4)
  azureOpenaiBaseUrl?: string; // clearable: omit = reset to env default (4.4)
  azureOpenaiApiVersion?: string; // clearable: omit = reset to env default (4.4)
  azureOpenaiUseEntraId?: boolean; // part of the ai:azureOpenaiSettings object (full-state replace)
}

/**
 * The config keys this feature manages: the AI enablement toggle plus the 5
 * `ai:*` settings (the Azure OpenAI connection config is one `ai:azureOpenaiSettings`
 * JSON object). It mirrors the env-only group declared in config-definition
 * (`env:useOnlyEnvVars:ai`). Keep this in sync with that group.
 */
export const AI_SETTING_KEYS = [
  'app:aiEnabled',
  'ai:provider',
  'ai:apiKey',
  'ai:model',
  'ai:providerOptions',
  'ai:azureOpenaiSettings',
] as const;
