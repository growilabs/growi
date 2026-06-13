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
 * Two groups are EXCEPTIONS and behave as merge (omit = keep the current value):
 *   - `apiKey`: an empty or omitted value keeps the existing stored key; it is
 *     never cleared by this request. A new key is applied only when a non-empty
 *     string is sent (Req 5.x).
 *   - the booleans (`aiEnabled`, `azureOpenaiUseEntraId`): applied only when
 *     explicitly provided; omitting one leaves the stored value untouched.
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
  azureOpenaiResourceName?: string; // clearable: omit = reset to env default (4.4)
  azureOpenaiBaseUrl?: string; // clearable: omit = reset to env default (4.4)
  azureOpenaiApiVersion?: string; // clearable: omit = reset to env default (4.4)
  azureOpenaiUseEntraId?: boolean; // merge: applied only when provided; omit = keep
}

/**
 * The config keys this feature manages: the AI enablement toggle plus the 8
 * `ai:*` settings. Server handlers iterate this list to build the GET response
 * and apply PUT updates, and it mirrors the env-only group declared in
 * config-definition (`env:useOnlyEnvVars:ai`). Keep this in sync with that group.
 */
export const AI_SETTING_KEYS = [
  'app:aiEnabled',
  'ai:provider',
  'ai:apiKey',
  'ai:model',
  'ai:providerOptions',
  'ai:azureOpenaiResourceName',
  'ai:azureOpenaiBaseUrl',
  'ai:azureOpenaiApiVersion',
  'ai:azureOpenaiUseEntraId',
] as const;
