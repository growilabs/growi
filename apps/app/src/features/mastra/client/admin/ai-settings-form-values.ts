import type { AiProvider } from '../../interfaces/ai-provider';
import type {
  AiSettingsResponse,
  AiSettingsUpdateRequest,
} from '../../interfaces/ai-settings';
import type { AllowedModel } from '../../interfaces/allowed-model';
import type { AzureOpenaiConfig } from '../../interfaces/azure-openai-config';

/**
 * The react-hook-form working copy for a single allowed-model row.
 *
 * `providerOptions` is held as a raw JSON *string* (`providerOptionsText`) while
 * editing — the textarea binds to a string and the inline JSON validator runs on
 * it — and is parsed/stringified at the API boundary. `isDefault` binds to the
 * row's "default" radio; exactly one row is the default across the list.
 */
export interface AllowedModelFormValue {
  model: string;
  providerOptionsText: string;
  isDefault: boolean;
}

/**
 * The react-hook-form working copy for the AI settings admin form.
 *
 * `apiKey` is write-only and is NOT seeded from the server (the GET never
 * returns the stored key, R5.2); it starts blank and is only sent when the
 * admin types a new value. `provider` uses `''` for the unselected state so the
 * `<select>` is never bound to `undefined`. String fields default to '' so the
 * registered inputs are never `undefined`.
 *
 * `allowedModels` is the per-model allow-list, edited as a `useFieldArray`. Each
 * row carries the model id, its providerOptions as raw JSON text, and an
 * `isDefault` flag (exactly one row is the default).
 *
 * `azureOpenaiSettings` reuses the storage/API `AzureOpenaiConfig`, wrapped in
 * `Required<>` so every input is a controlled value (strings '', not undefined).
 */
export interface AiSettingsFormValues {
  aiEnabled: boolean;
  provider: AiProvider | '';
  apiKey: string;
  allowedModels: AllowedModelFormValue[];
  azureOpenaiSettings: Required<AzureOpenaiConfig>;
}

/**
 * Seed the form values from the server response.
 *
 * `apiKey` is always '' (write-only, never seeded). `provider` falls back to ''
 * (unselected) and optional strings to ''. Each allowed model's `providerOptions`
 * object is stringified into `providerOptionsText` ('' when absent) so the
 * textarea binds to a string, and `isDefault` is copied (defaulting to false).
 * The azure object's optional fields are filled with '' / false so the inputs
 * stay controlled.
 */
export const toFormValues = (
  data: AiSettingsResponse,
): AiSettingsFormValues => ({
  aiEnabled: data.aiEnabled,
  provider: data.provider ?? '',
  apiKey: '',
  allowedModels: data.allowedModels.map((m) => ({
    model: m.model,
    providerOptionsText:
      m.providerOptions != null ? JSON.stringify(m.providerOptions) : '',
    isDefault: m.isDefault ?? false,
  })),
  azureOpenaiSettings: {
    resourceName: data.azureOpenaiSettings.resourceName ?? '',
    baseURL: data.azureOpenaiSettings.baseURL ?? '',
    apiVersion: data.azureOpenaiSettings.apiVersion ?? '',
    useEntraId: data.azureOpenaiSettings.useEntraId ?? false,
  },
});

/**
 * Map a single allowed-model form row to its `AllowedModel` DTO entry.
 *
 * `providerOptionsText` is parsed into `providerOptions`; an empty (or
 * whitespace-only) text omits the field entirely so the model is stored as
 * "no options" (R2.3). The text is assumed valid JSON here — the form rejects an
 * invalid value before submit via the inline validator (R2.4). `isDefault` is
 * copied through.
 */
const toAllowedModel = (row: AllowedModelFormValue): AllowedModel => {
  const trimmed = row.providerOptionsText.trim();
  const base: AllowedModel = { model: row.model, isDefault: row.isDefault };
  if (trimmed === '') {
    return base;
  }
  return { ...base, providerOptions: JSON.parse(trimmed) };
};

/**
 * Map the form values to the PUT request body.
 *
 * `aiEnabled` is always included. The `azureOpenaiSettings` object is sent as-is
 * (including '' strings), which the server normalizes — emptied fields are dropped
 * and an all-empty object falls back to the env default (R4.4). `provider` ''
 * (the unselected sentinel) is sent as `undefined`. `allowedModels` is sent as the
 * full FULL-STATE-REPLACE list, each row's `providerOptionsText` parsed into
 * `providerOptions` (empty => omitted) and `isDefault` copied. `apiKey` is the only
 * exception: it is included only when the admin typed a value, so a blank field
 * keeps the existing stored key (R5.x).
 */
export const buildUpdateRequest = (
  values: AiSettingsFormValues,
): AiSettingsUpdateRequest => {
  const body: AiSettingsUpdateRequest = {
    aiEnabled: values.aiEnabled,
    provider: values.provider === '' ? undefined : values.provider,
    allowedModels: values.allowedModels.map(toAllowedModel),
    azureOpenaiSettings: values.azureOpenaiSettings,
  };
  if (values.apiKey !== '') {
    body.apiKey = values.apiKey;
  }
  return body;
};
