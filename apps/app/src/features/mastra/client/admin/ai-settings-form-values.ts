import type { AiProvider } from '../../interfaces/ai-provider';
import { AI_PROVIDERS } from '../../interfaces/ai-provider';
import type {
  AiProviderUpdateRequest,
  AiSettingsResponse,
  AiSettingsUpdateRequest,
} from '../../interfaces/ai-settings';
import type { AllowedModel } from '../../interfaces/allowed-model';
import type { AzureOpenaiConfig } from '../../interfaces/azure-openai-config';
import {
  evaluateProviderAvailability,
  type ProviderAvailability,
} from '../../interfaces/provider-availability-rule';

/**
 * The react-hook-form working copy for a single provider slot.
 *
 * `apiKey` is write-only and is NEVER seeded from the server (the GET returns
 * only `isApiKeySet`, never the stored key — R1.8/R1.9); it starts blank and is
 * sent only when the admin types a new value, so a blank field keeps the stored
 * key (R1.4). `azureOpenaiSettings` reuses the storage/API `AzureOpenaiConfig`
 * wrapped in `Required<>` so every input is a controlled value (strings '', not
 * undefined) — it is only meaningful for the 'azure-openai' slot's panel.
 */
export interface ProviderFormValue {
  enabled: boolean;
  apiKey: string; // write-only; '' = unchanged (never seeded from GET)
  azureOpenaiSettings: Required<AzureOpenaiConfig>;
}

/**
 * The react-hook-form working copy for a single allowed-model row.
 *
 * `provider` is the owning provider (R2.1). `providerOptions` is held as a raw
 * JSON *string* (`providerOptionsText`) while editing — the textarea binds to a
 * string and the inline JSON validator runs on it — and is parsed/stringified at
 * the API boundary. `isDefault` binds to the row's "default" control; exactly one
 * row across the whole cross-provider list is the global default (R3.1).
 */
export interface AllowedModelFormValue {
  provider: AiProvider;
  modelId: string;
  providerOptionsText: string; // raw JSON text while editing
  isDefault: boolean;
}

/**
 * The react-hook-form working copy for the AI settings admin form.
 *
 * `providers` is a fixed-slot Record over ALL supported providers (R1.1): a
 * disabled/unconfigured provider is still present as an entry, never omitted.
 * `allowedModels` is a single flat cross-provider array so the global single
 * default can be validated across providers (R3.1).
 */
export interface AiSettingsFormValues {
  aiEnabled: boolean;
  providers: Record<AiProvider, ProviderFormValue>;
  allowedModels: AllowedModelFormValue[]; // flat single array (global default lives here)
}

/**
 * Build a fully-controlled azure settings object, defaulting every field so the
 * bound inputs are never `undefined`. Built for every provider slot even though
 * only the 'azure-openai' panel reads it.
 */
const toAzureFormSettings = (
  config?: AzureOpenaiConfig,
): Required<AzureOpenaiConfig> => ({
  resourceName: config?.resourceName ?? '',
  baseURL: config?.baseURL ?? '',
  apiVersion: config?.apiVersion ?? '',
  useEntraId: config?.useEntraId ?? false,
});

/**
 * Seed the form values from the GET response.
 *
 * `providers` is rebuilt over the declared `AI_PROVIDERS` set so every fixed slot
 * has an entry regardless of what the response contains (R1.1). Each slot's
 * `enabled` comes from the response; `apiKey` is ALWAYS '' (write-only, never
 * seeded — `isApiKeySet` only drives the panel's placeholder, not the form value);
 * the azure object is a controlled object with every field defaulted. Each allowed
 * model's `providerOptions` object is pretty-printed (2-space) into
 * `providerOptionsText` ('' when absent) so the textarea binds to a string and
 * re-seeds as readable multi-line JSON after a save; `provider` and `isDefault`
 * (defaulting to false) are copied through.
 */
export const toFormValues = (
  data: AiSettingsResponse,
): AiSettingsFormValues => {
  // Object.fromEntries widens to `{ [k: string]: T }`; the `as` narrows it back
  // to the fixed-slot Record — sound because we iterate the full AI_PROVIDERS set
  // (matches get-ai-settings.ts). AI_PROVIDERS stays the single source of truth.
  const providers = Object.fromEntries(
    AI_PROVIDERS.map((p): [AiProvider, ProviderFormValue] => {
      const status = data.providers[p];
      return [
        p,
        {
          enabled: status?.enabled ?? false,
          apiKey: '',
          azureOpenaiSettings: toAzureFormSettings(status?.azureOpenaiSettings),
        },
      ];
    }),
  ) as Record<AiProvider, ProviderFormValue>;

  return {
    aiEnabled: data.aiEnabled,
    providers,
    allowedModels: data.allowedModels.map((m) => ({
      provider: m.provider,
      modelId: m.modelId,
      // Pretty-print (2-space) so the textarea re-seeds as readable, multi-line
      // JSON after a save. The stored value is the parsed object — the admin's
      // original whitespace is not persisted — so this canonical formatting is
      // what keeps a saved value from collapsing to a single minified line.
      providerOptionsText:
        m.providerOptions != null
          ? JSON.stringify(m.providerOptions, null, 2)
          : '',
      isDefault: m.isDefault ?? false,
    })),
  };
};

/**
 * Map a single allowed-model form row to its `AllowedModel` DTO entry.
 *
 * `provider` and `isDefault` are copied through. `providerOptionsText` is parsed
 * into `providerOptions`; an empty (or whitespace-only) text omits the field so
 * the model is stored as "no options" (R2.3). The text is assumed valid JSON here
 * — the form rejects an invalid value before submit via the inline validator
 * (R2.4).
 */
const toAllowedModel = (row: AllowedModelFormValue): AllowedModel => {
  const trimmed = row.providerOptionsText.trim();
  const base: AllowedModel = {
    provider: row.provider,
    modelId: row.modelId,
    isDefault: row.isDefault,
  };
  if (trimmed === '') {
    return base;
  }
  return { ...base, providerOptions: JSON.parse(trimmed) };
};

/**
 * Map a single provider slot to its `AiProviderUpdateRequest` section.
 *
 * `enabled` is always sent (full-state replace). `apiKey` is the merge exception:
 * included ONLY when non-empty, so a blank field keeps the stored key (R1.4).
 * `azureOpenaiSettings` is attached only to the 'azure-openai' slot.
 */
const toProviderUpdate = (
  provider: AiProvider,
  fv: ProviderFormValue,
): AiProviderUpdateRequest => ({
  enabled: fv.enabled,
  ...(fv.apiKey !== '' ? { apiKey: fv.apiKey } : {}),
  ...(provider === 'azure-openai'
    ? { azureOpenaiSettings: fv.azureOpenaiSettings }
    : {}),
});

/**
 * Whether a react-hook-form `dirtyFields` subtree contains ANY dirty leaf.
 *
 * `dirtyFields` mirrors the form shape with `true` at each changed leaf (nested
 * arrays/objects for array/nested fields); an untouched subtree is `undefined`.
 * Used to decide whether a whole section (e.g. `allowedModels`) was edited so an
 * unchanged section can be omitted from the PUT. Errs toward `true` (send) on any
 * dirty marker — the safe direction, since the server then validates the section.
 */
export const hasDirtyField = (dirty: unknown): boolean => {
  if (Array.isArray(dirty)) {
    return dirty.some(hasDirtyField);
  }
  if (dirty != null && typeof dirty === 'object') {
    return Object.values(dirty).some(hasDirtyField);
  }
  return dirty === true;
};

/**
 * Map the form values to the PUT request body.
 *
 * `allowedModels` is included ONLY when `allowedModelsDirty` (the admin actually
 * edited the list). An untouched list is omitted (PUT "omit = leave unchanged")
 * so an unrelated save (provider toggle / apiKey / aiEnabled) is never blocked by
 * the list's validity: an env-seeded list with no default is valid at runtime
 * (first-entry fallback) but fails the exactly-one-default PUT rule (Req 3.2), so
 * re-sending it unchanged would 400 the whole save.
 *
 * In env-only mode (`useOnlyEnvVars === true`) `providers` and `aiEnabled` are
 * deliberately omitted (the server rejects them with 400 under env-only; model
 * settings stay editable — R5.3), so the body is just the (possibly omitted)
 * allowedModels section.
 *
 * In normal mode all 4 provider entries are sent (the server validator requires
 * the complete fixed-slot set when `providers` is present), alongside `aiEnabled`
 * and the (possibly omitted) allowedModels.
 */
export const buildUpdateRequest = (
  values: AiSettingsFormValues,
  useOnlyEnvVars: boolean,
  allowedModelsDirty: boolean,
): AiSettingsUpdateRequest => {
  const allowedModelsSection = allowedModelsDirty
    ? { allowedModels: values.allowedModels.map(toAllowedModel) }
    : {};

  if (useOnlyEnvVars) {
    return allowedModelsSection;
  }

  // See toFormValues: `as` narrows the widened fromEntries result to the
  // fixed-slot Record; sound because every AI_PROVIDERS entry is mapped.
  const providers = Object.fromEntries(
    AI_PROVIDERS.map((p): [AiProvider, AiProviderUpdateRequest] => [
      p,
      toProviderUpdate(p, values.providers[p]),
    ]),
  ) as Record<AiProvider, AiProviderUpdateRequest>;

  return {
    aiEnabled: values.aiEnabled,
    providers,
    ...allowedModelsSection,
  };
};

/**
 * Return a NEW allowed-model list in which exactly the row at `targetIndex` is
 * the default and every other row is not — always exactly one default (R3.1).
 *
 * Shared by the DefaultModelSelector (cross-provider dropdown) and the per-row
 * "★" control so the single-default invariant is rewritten identically from both
 * call sites. Index-based to match the single global `useFieldArray`; consumers
 * that display a provider-filtered view map their display row back to the
 * original index before calling this.
 */
export const setDefaultAllowedModelAt = (
  models: AllowedModelFormValue[],
  targetIndex: number,
): AllowedModelFormValue[] =>
  models.map((model, index) => ({
    ...model,
    isDefault: index === targetIndex,
  }));

/**
 * Compute a provider's availability from its LIVE form values plus the saved-key
 * flag, through the SAME pure rule the server uses (`evaluateProviderAvailability`)
 * — so the admin UI's status dot (ProviderTabs) and inline misconfiguration warning
 * (ProviderPanel) cannot drift from what the server would exclude. `hasApiKey` is
 * the saved-key flag (from the GET response, reflecting the merged DB??env view) OR
 * a non-empty typed key in the form; this saved-OR-typed composition is the subtle
 * part, so it lives in ONE place shared by both call sites.
 */
export const evaluateFormProviderAvailability = (
  provider: AiProvider,
  formValue: ProviderFormValue | undefined,
  isApiKeySet: boolean,
): ProviderAvailability =>
  evaluateProviderAvailability({
    provider,
    enabled: formValue?.enabled === true,
    hasApiKey: isApiKeySet || (formValue?.apiKey ?? '').trim() !== '',
    azureOpenaiSettings: formValue?.azureOpenaiSettings,
  });
