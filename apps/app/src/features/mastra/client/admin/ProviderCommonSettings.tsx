import type { JSX } from 'react';
import { useCallback, useId } from 'react';
import { useTranslation } from 'next-i18next';
import { FormFeedback, FormGroup, FormText, Input, Label } from 'reactstrap';

import { AI_PROVIDERS, type AiProvider } from '../../interfaces/ai-provider';
import { isValidProviderOptionsJson } from './provider-options-validation';

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
  /** Current `ai:provider` value (undefined when not yet configured). */
  readonly provider?: AiProvider;
  /** In-progress `ai:apiKey` input; write-only (empty = keep existing). */
  readonly apiKey: string;
  /** Current `ai:model` value. */
  readonly model: string;
  /** Current `ai:providerOptions` raw JSON string. */
  readonly providerOptions: string;
  /** Whether an apiKey is already stored on the server (5.2). */
  readonly isApiKeySet: boolean;
  /**
   * Disable the inputs when env-only mode is active (4.2). `disabled` (not
   * `readOnly`) is used so the locked fields are also removed from the tab order
   * and cannot receive focus, matching the always-`disabled` provider select.
   */
  readonly disabled: boolean;
  readonly onChangeProvider: (next: AiProvider) => void;
  readonly onChangeApiKey: (next: string) => void;
  readonly onChangeModel: (next: string) => void;
  readonly onChangeProviderOptions: (next: string) => void;
}

/**
 * Presentational, controlled form for the provider-agnostic AI settings:
 * `ai:provider` / `ai:apiKey` / `ai:model` / `ai:providerOptions` (2.1).
 *
 * The provider select offers only the supported providers (2.2). The apiKey
 * field is password-masked (5.1) and write-only. `providerOptions` is checked
 * for JSON validity locally and surfaces an inline error (6.2). Every input is
 * disabled (not focusable) when `disabled` (driven by `useOnlyEnvVars`) is true.
 */
export const ProviderCommonSettings = (
  props: ProviderCommonSettingsProps,
): JSX.Element => {
  const {
    provider,
    apiKey,
    model,
    providerOptions,
    isApiKeySet,
    disabled,
    onChangeProvider,
    onChangeApiKey,
    onChangeModel,
    onChangeProviderOptions,
  } = props;
  const { t } = useTranslation('admin');

  const providerId = useId();
  const apiKeyId = useId();
  const modelId = useId();
  const providerOptionsId = useId();

  const handleProviderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChangeProvider(e.target.value as AiProvider);
    },
    [onChangeProvider],
  );

  const isProviderOptionsInvalid = !isValidProviderOptionsJson(providerOptions);

  return (
    <>
      <FormGroup className="mb-3">
        <Label for={providerId}>{t('ai_settings.provider_label')}</Label>
        <Input
          id={providerId}
          type="select"
          value={provider ?? ''}
          disabled={disabled}
          onChange={handleProviderChange}
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
          value={apiKey}
          disabled={disabled}
          autoComplete="new-password"
          placeholder={
            isApiKeySet ? t('ai_settings.api_key_set_placeholder') : ''
          }
          onChange={(e) => onChangeApiKey(e.target.value)}
        />
        <FormText>{t('ai_settings.api_key_help')}</FormText>
      </FormGroup>

      <FormGroup className="mb-3">
        <Label for={modelId}>{t('ai_settings.model_label')}</Label>
        <Input
          id={modelId}
          type="text"
          value={model}
          disabled={disabled}
          onChange={(e) => onChangeModel(e.target.value)}
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
          value={providerOptions}
          disabled={disabled}
          invalid={isProviderOptionsInvalid}
          onChange={(e) => onChangeProviderOptions(e.target.value)}
        />
        {isProviderOptionsInvalid && (
          <FormFeedback>
            {t('ai_settings.provider_options_invalid_json')}
          </FormFeedback>
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
