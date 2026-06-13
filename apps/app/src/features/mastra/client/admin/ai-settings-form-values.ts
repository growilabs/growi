import type { AiProvider } from '../../interfaces/ai-provider';
import type {
  AiSettingsResponse,
  AiSettingsUpdateRequest,
} from '../../interfaces/ai-settings';

/**
 * The react-hook-form working copy for the AI settings admin form.
 *
 * `apiKey` is write-only and is NOT seeded from the server (the GET never
 * returns the stored key, R5.2); it starts blank and is only sent when the
 * admin types a new value. `provider` uses `''` for the unselected state so the
 * `<select>` is never bound to `undefined`. String fields default to '' so the
 * registered inputs are never `undefined`.
 */
export interface AiSettingsFormValues {
  aiEnabled: boolean;
  provider: AiProvider | '';
  apiKey: string;
  model: string;
  providerOptions: string;
  azureOpenaiResourceName: string;
  azureOpenaiBaseUrl: string;
  azureOpenaiApiVersion: string;
  azureOpenaiUseEntraId: boolean;
}

/**
 * Seed the form values from the server response.
 *
 * `apiKey` is always '' (write-only, never seeded). `provider` falls back to ''
 * (unselected) and optional strings to ''. Booleans pass through as-is.
 */
export const toFormValues = (
  data: AiSettingsResponse,
): AiSettingsFormValues => ({
  aiEnabled: data.aiEnabled,
  provider: data.provider ?? '',
  apiKey: '',
  model: data.model ?? '',
  providerOptions: data.providerOptions ?? '',
  azureOpenaiResourceName: data.azureOpenaiResourceName ?? '',
  azureOpenaiBaseUrl: data.azureOpenaiBaseUrl ?? '',
  azureOpenaiApiVersion: data.azureOpenaiApiVersion ?? '',
  azureOpenaiUseEntraId: data.azureOpenaiUseEntraId,
});

/**
 * Map the form values to the PUT request body.
 *
 * Booleans (`aiEnabled` / `azureOpenaiUseEntraId`) are always included. String
 * fields are sent as-is (including ''), which the server normalizes to remove
 * the DB value and fall back to the env default (R4.4). `provider` '' (the
 * unselected sentinel) is sent as `undefined`. `apiKey` is the only exception:
 * it is included only when the admin typed a value, so a blank field keeps the
 * existing stored key (R5.x).
 */
export const buildUpdateRequest = (
  values: AiSettingsFormValues,
): AiSettingsUpdateRequest => {
  const body: AiSettingsUpdateRequest = {
    aiEnabled: values.aiEnabled,
    provider: values.provider === '' ? undefined : values.provider,
    model: values.model,
    providerOptions: values.providerOptions,
    azureOpenaiResourceName: values.azureOpenaiResourceName,
    azureOpenaiBaseUrl: values.azureOpenaiBaseUrl,
    azureOpenaiApiVersion: values.azureOpenaiApiVersion,
    azureOpenaiUseEntraId: values.azureOpenaiUseEntraId,
  };
  if (values.apiKey !== '') {
    body.apiKey = values.apiKey;
  }
  return body;
};
