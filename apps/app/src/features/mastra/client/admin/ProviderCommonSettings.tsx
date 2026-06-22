import type { JSX } from 'react';
import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'next-i18next';
import { useFormContext } from 'react-hook-form';
import { FormGroup, FormText, Input, Label } from 'reactstrap';

import { AI_PROVIDERS } from '../../interfaces/ai-provider';
import { AllowedModelsField } from './AllowedModelsField';
import type { AiSettingsFormValues } from './ai-settings-form-values';
import { registerToInputProps } from './register-to-input-props';

export interface ProviderCommonSettingsProps {
  /** Whether an apiKey is already stored on the server (5.2). */
  readonly isApiKeySet: boolean;
  /**
   * Disable the inputs when env-only mode is active (1.6). `disabled` (not
   * `readOnly`) is used so the locked fields are also removed from the tab order
   * and cannot receive focus.
   */
  readonly disabled: boolean;
}

/**
 * Register-based form for the provider-agnostic AI settings:
 * `ai:provider` / `ai:apiKey` plus the `ai:allowedModels` list editor (2.1).
 *
 * Reads/writes the shared react-hook-form context owned by `AiSettings`. The
 * provider select offers only the supported providers (2.2). The apiKey field
 * is password-masked (5.1) and write-only. The allowed-models list (with its
 * per-row providerOptions JSON validation) is hosted here as a single field for
 * every provider; the `AllowedModelsField` itself switches the row label between
 * the generic model id and the Azure deployment name based on the watched
 * provider. Every input is disabled (not focusable) when `disabled` (driven by
 * `useOnlyEnvVars`) is true.
 */
export const ProviderCommonSettings = (
  props: ProviderCommonSettingsProps,
): JSX.Element => {
  const { isApiKeySet, disabled } = props;
  const { t } = useTranslation('admin');
  const {
    register,
    watch,
    setValue,
    formState: { dirtyFields },
  } = useFormContext<AiSettingsFormValues>();

  const providerId = useId();
  const apiKeyId = useId();

  // SECURITY (mirrors the server-side guard in put-ai-settings): `ai:apiKey` is a
  // single key shared by every provider, so switching provider would otherwise
  // reuse the previous provider's stored secret against the new one. On a genuine
  // provider switch, drop any key typed for the old provider so it is not
  // submitted; the server clears the stored key too unless a new one is entered.
  const provider = watch('provider');
  const prevProviderRef = useRef(provider);
  useEffect(() => {
    // Only react to a real change away from a previously-defined provider — not
    // the initial seed (undefined -> loaded value) nor the post-save re-seed.
    if (
      prevProviderRef.current != null &&
      prevProviderRef.current !== provider
    ) {
      setValue('apiKey', '', { shouldDirty: true });
    }
    prevProviderRef.current = provider;
  }, [provider, setValue]);

  // Warn only when a stored key actually exists and the admin has changed the
  // provider from the loaded value (dirtyFields is reset on (re)load/save).
  const showApiKeyProviderChangeWarning =
    isApiKeySet && dirtyFields.provider === true;

  return (
    <>
      <h2 className="border-bottom my-4 admin-setting-header">
        {t('ai_settings.common_settings_title')}
      </h2>

      <FormGroup className="mb-3">
        <Label for={providerId}>{t('ai_settings.provider_label')}</Label>
        <Input
          id={providerId}
          type="select"
          disabled={disabled}
          {...registerToInputProps(register('provider'))}
        >
          <option value="">{t('ai_settings.provider_placeholder')}</option>
          {AI_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Input>
      </FormGroup>

      <FormGroup className="mb-3">
        <Label for={apiKeyId}>{t('ai_settings.api_key_label')}</Label>
        <Input
          id={apiKeyId}
          type="password"
          disabled={disabled}
          autoComplete="new-password"
          placeholder={
            isApiKeySet ? t('ai_settings.api_key_set_placeholder') : ''
          }
          {...registerToInputProps(register('apiKey'))}
        />
        <FormText>{t('ai_settings.api_key_help')}</FormText>
        {showApiKeyProviderChangeWarning && (
          <FormText
            color="warning"
            className="d-flex align-items-center text-warning mt-1"
          >
            <span className="material-symbols-outlined fs-6 me-1">warning</span>
            {t('ai_settings.api_key_provider_change_warning')}
          </FormText>
        )}
      </FormGroup>

      {/* The allowed-models list (incl. each model's providerOptions) is hosted
          here as a single field for every provider. It switches the row label
          to the Azure deployment name when the watched provider is Azure OpenAI,
          so the per-model storage (`ai:allowedModels`) is shared across
          providers without a provider-specific branch leaking here. */}
      <AllowedModelsField disabled={disabled} />
    </>
  );
};
