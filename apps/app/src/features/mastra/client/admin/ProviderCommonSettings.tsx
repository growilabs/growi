import type { JSX } from 'react';
import { useId } from 'react';
import { useTranslation } from 'next-i18next';
import { useFormContext } from 'react-hook-form';
import { FormFeedback, FormGroup, FormText, Input, Label } from 'reactstrap';

import { AI_PROVIDERS } from '../../interfaces/ai-provider';
import type { AiSettingsFormValues } from './ai-settings-form-values';
import { isValidProviderOptionsJson } from './provider-options-validation';
import { registerToInputProps } from './register-to-input-props';

// Vercel AI SDK docs describing the provider-namespaced `providerOptions` shape.
const PROVIDER_OPTIONS_DOC_URL =
  'https://ai-sdk.dev/docs/foundations/provider-options';

// Shown as the textarea placeholder to illustrate the provider-namespaced JSON
// shape. Language-neutral (a code example), so it is not an i18n string.
const PROVIDER_OPTIONS_PLACEHOLDER = `{
    "openai": {
        "reasoningEffort": "low",
        "reasoningSummary": "auto"
    },
}`;

export interface ProviderCommonSettingsProps {
  /** Whether an apiKey is already stored on the server (5.2). */
  readonly isApiKeySet: boolean;
  /**
   * Disable the inputs when env-only mode is active (4.2). `disabled` (not
   * `readOnly`) is used so the locked fields are also removed from the tab order
   * and cannot receive focus.
   */
  readonly disabled: boolean;
}

/**
 * Register-based form for the provider-agnostic AI settings:
 * `ai:provider` / `ai:apiKey` / `ai:model` / `ai:providerOptions` (2.1).
 *
 * Reads/writes the shared react-hook-form context owned by `AiSettings`. The
 * provider select offers only the supported providers (2.2). The apiKey field
 * is password-masked (5.1) and write-only. `providerOptions` is validated as
 * JSON via a register validate rule and surfaces an inline error (6.2). Every
 * input is disabled (not focusable) when `disabled` (driven by `useOnlyEnvVars`)
 * is true.
 */
export const ProviderCommonSettings = (
  props: ProviderCommonSettingsProps,
): JSX.Element => {
  const { isApiKeySet, disabled } = props;
  const { t } = useTranslation('admin');
  const {
    register,
    formState: { errors },
  } = useFormContext<AiSettingsFormValues>();

  const providerId = useId();
  const apiKeyId = useId();
  const modelId = useId();
  const providerOptionsId = useId();

  return (
    <>
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
      </FormGroup>

      <FormGroup className="mb-3">
        <Label for={modelId}>{t('ai_settings.model_label')}</Label>
        <Input
          id={modelId}
          type="text"
          disabled={disabled}
          {...registerToInputProps(register('model'))}
        />
      </FormGroup>

      <FormGroup className="mb-3">
        <Label for={providerOptionsId}>
          {t('ai_settings.provider_options_label')}
        </Label>
        <Input
          id={providerOptionsId}
          type="textarea"
          rows={6}
          placeholder={PROVIDER_OPTIONS_PLACEHOLDER}
          disabled={disabled}
          invalid={errors.providerOptions != null}
          {...registerToInputProps(
            register('providerOptions', {
              validate: (v) =>
                isValidProviderOptionsJson(v) ||
                t('ai_settings.provider_options_invalid_json'),
            }),
          )}
        />
        {errors.providerOptions != null && (
          <FormFeedback>{errors.providerOptions.message}</FormFeedback>
        )}
        <FormText>
          <span
            // biome-ignore lint/security/noDangerouslySetInnerHtml: includes <br> markup from i18n strings
            dangerouslySetInnerHTML={{
              __html: t('ai_settings.provider_options_help'),
            }}
          />{' '}
          <a
            href={PROVIDER_OPTIONS_DOC_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {PROVIDER_OPTIONS_DOC_URL}
          </a>
        </FormText>
      </FormGroup>
    </>
  );
};
