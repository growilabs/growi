import type { AiProvider } from './ai-provider';
import type { AllowedModel } from './allowed-model';
import type { AzureOpenaiConfig } from './azure-openai-config';

/**
 * Per-provider status returned by the admin API. The stored API key value is
 * never returned — only `isApiKeySet` (Req 1.8, 1.9). `azureOpenaiSettings` is
 * only present on the 'azure-openai' entry.
 */
export interface AiProviderStatus {
  enabled: boolean;
  isApiKeySet: boolean;
  azureOpenaiSettings?: AzureOpenaiConfig;
}

/**
 * GET /_api/v3/ai-settings response.
 *
 * Exposes the currently effective AI configuration to the admin UI.
 * `providers` always contains ALL 4 supported providers (fixed-slot model —
 * Req 1.1): an unconfigured provider is returned as a disabled entry, never
 * omitted. The boolean flags (`useOnlyEnvVars`, `isConfigured`) let the UI
 * decide editability and whether to surface the "enabled but not configured"
 * warning.
 */
export interface AiSettingsResponse {
  aiEnabled: boolean; // state of app:aiEnabled
  providers: Record<AiProvider, AiProviderStatus>; // all 4 providers, always present (fixed slots)
  allowedModels: AllowedModel[]; // cross-provider allow-list incl. isDefault; always an array
  useOnlyEnvVars: boolean; // when env:useOnlyEnvVars:ai is on, provider connection settings are read-only (5.2)
  isConfigured: boolean; // result of isAiConfigured(), used for the "enabled but not configured" warning
}

/**
 * Per-provider section of the PUT request. The section is FULL-STATE REPLACE
 * (`enabled` omitted = false), with ONE merge exception: `apiKey` is write-only
 * — an empty or omitted value keeps the stored key (Req 1.4; there is no clear
 * operation), and a new key is applied only when a non-empty string is sent.
 * `azureOpenaiSettings` is one full-state-replace unit (only meaningful for
 * 'azure-openai').
 */
export interface AiProviderUpdateRequest {
  enabled?: boolean; // omitted = false (full-state replace)
  apiKey?: string; // merge exception: empty/omitted keeps the stored key (1.4)
  azureOpenaiSettings?: AzureOpenaiConfig; // full-state replace ('azure-openai' only)
}

/**
 * PUT /_api/v3/ai-settings request.
 *
 * Semantics: each top-level section (`aiEnabled` / `providers` /
 * `allowedModels`) is OMIT = LEAVE UNCHANGED; a present section is a
 * full-state replace of that section (no implicit reset of omitted sections —
 * unlike the former single-provider contract). When `providers` is present it
 * MUST contain an entry for every supported provider (validator-enforced,
 * matching the fixed-slot model). An empty `allowedModels` array is accepted
 * and stored as "no allowed models" (Req 3.3). In env-only mode a request
 * containing `providers` or `aiEnabled` is rejected with 400; only
 * `allowedModels` is editable (Req 5.2, 5.3).
 */
export interface AiSettingsUpdateRequest {
  aiEnabled?: boolean; // omitted = leave unchanged
  providers?: Record<AiProvider, AiProviderUpdateRequest>; // omitted = leave unchanged; present = all 4 entries required
  allowedModels?: AllowedModel[]; // omitted = leave unchanged; present = full-state replace ([] = no allowed models, 3.3)
}
