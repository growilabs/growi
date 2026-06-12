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
 * All fields are optional. `apiKey` is special: an empty/omitted value keeps the
 * existing stored key (it is never cleared by this request).
 */
export interface AiSettingsUpdateRequest {
  aiEnabled?: boolean; // toggle for app:aiEnabled (7.1)
  provider?: AiProvider;
  apiKey?: string; // empty/omitted keeps the existing value (5.x)
  model?: string;
  providerOptions?: string;
  azureOpenaiResourceName?: string;
  azureOpenaiBaseUrl?: string;
  azureOpenaiApiVersion?: string;
  azureOpenaiUseEntraId?: boolean;
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
