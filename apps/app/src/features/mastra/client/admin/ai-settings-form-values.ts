import type { AiProvider } from '../../interfaces/ai-provider';
import type {
  AiSettingsResponse,
  AiSettingsUpdateRequest,
} from '../../interfaces/ai-settings';
import type { AzureOpenaiConfig } from '../../interfaces/azure-openai-config';

/**
 * The react-hook-form working copy for the AI settings admin form.
 *
 * `apiKey` is write-only and is NOT seeded from the server (the GET never
 * returns the stored key, R5.2); it starts blank and is only sent when the
 * admin types a new value. `provider` uses `''` for the unselected state so the
 * `<select>` is never bound to `undefined`. String fields default to '' so the
 * registered inputs are never `undefined`.
 *
 * `azureOpenaiSettings` reuses the storage/API `AzureOpenaiConfig`, wrapped in
 * `Required<>` so every input is a controlled value (strings '', not undefined).
 */
export interface AiSettingsFormValues {
  aiEnabled: boolean;
  provider: AiProvider | '';
  apiKey: string;
  model: string;
  providerOptions: string;
  azureOpenaiSettings: Required<AzureOpenaiConfig>;
}

/**
 * Seed the form values from the server response.
 *
 * `apiKey` is always '' (write-only, never seeded). `provider` falls back to ''
 * (unselected) and optional strings to ''. The azure object's optional fields are
 * filled with '' / false so the inputs stay controlled.
 */
export const toFormValues = (
  data: AiSettingsResponse,
): AiSettingsFormValues => ({
  aiEnabled: data.aiEnabled,
  provider: data.provider ?? '',
  apiKey: '',
  model: data.model ?? '',
  providerOptions: data.providerOptions ?? '',
  azureOpenaiSettings: {
    resourceName: data.azureOpenaiSettings.resourceName ?? '',
    baseURL: data.azureOpenaiSettings.baseURL ?? '',
    apiVersion: data.azureOpenaiSettings.apiVersion ?? '',
    useEntraId: data.azureOpenaiSettings.useEntraId ?? false,
  },
});

/**
 * Map the form values to the PUT request body.
 *
 * `aiEnabled` is always included. The `azureOpenaiSettings` object is sent as-is
 * (including '' strings), which the server normalizes — emptied fields are dropped
 * and an all-empty object falls back to the env default (R4.4). `provider` ''
 * (the unselected sentinel) is sent as `undefined`. `apiKey` is the only
 * exception: it is included only when the admin typed a value, so a blank field
 * keeps the existing stored key (R5.x).
 */
export const buildUpdateRequest = (
  values: AiSettingsFormValues,
): AiSettingsUpdateRequest => {
  const body: AiSettingsUpdateRequest = {
    aiEnabled: values.aiEnabled,
    provider: values.provider === '' ? undefined : values.provider,
    model: values.model,
    providerOptions: values.providerOptions,
    azureOpenaiSettings: values.azureOpenaiSettings,
  };
  if (values.apiKey !== '') {
    body.apiKey = values.apiKey;
  }
  return body;
};
