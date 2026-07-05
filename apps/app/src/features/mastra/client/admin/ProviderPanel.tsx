import type { JSX, ReactNode } from 'react';
import { useId } from 'react';
import { useTranslation } from 'next-i18next';
import { type FieldPath, useFormContext, useWatch } from 'react-hook-form';
import { Alert, Badge, FormGroup, Input, Label } from 'reactstrap';

import type { AiProvider } from '../../interfaces/ai-provider';
import { evaluateProviderAvailability } from '../../interfaces/provider-availability-rule';
import { AzureOpenaiSettings } from './AzureOpenaiSettings';
import type { AiSettingsFormValues } from './ai-settings-form-values';
import { registerToInputProps } from './register-to-input-props';

export interface ProviderPanelProps {
  /** The provider slot this panel edits. */
  readonly provider: AiProvider;
  /**
   * Whether this provider already has a stored API key, from the GET response.
   * Drives the "(configured)" placeholder and the key-status chip (R1.8); the
   * form's write-only `apiKey` field cannot reveal this.
   */
  readonly isApiKeySet: boolean;
  /**
   * env-only mode. When true, the *connection* settings (enabled toggle, apiKey,
   * and — for azure — the AzureOpenaiSettings fields) are disabled (not focusable)
   * because they are governed by environment variables (R5.2). Model editing is
   * NOT disabled by this panel (R5.3) — it stays in the `children` slot untouched.
   */
  readonly useOnlyEnvVars: boolean;
  /**
   * The models-list editor, injected by the caller (task 6.5 passes
   * `<AllowedModelsField provider={provider} .../>`). It is rendered at the models
   * insertion point and is deliberately NOT wrapped in the env-only disabled
   * treatment — model editing stays active even under env-only (R5.3); the child
   * owns its own disabled state.
   */
  readonly children?: ReactNode;
}

/**
 * One provider's settings panel (mock: ProviderPanel). Renders, in order:
 *   - the enable/disable toggle bound to `providers.<provider>.enabled` (R1.5),
 *   - an inline warning when the provider is enabled but misconfigured (a required
 *     API key or, for azure, an endpoint is missing) — computed from live form
 *     values via the shared availability rule; hidden for available/disabled,
 *   - the write-only API key input with a "(configured)" placeholder and a
 *     "API key set / not set" chip when a key is already stored (R1.8),
 *   - the models slot (`children` — filled by the caller in a later task),
 *   - the Azure connection settings, only for the azure-openai panel (R1.10).
 *
 * Reads/writes the shared react-hook-form context owned by `AiSettings`. The
 * connection settings are disabled (not focusable) under env-only mode (R5.2)
 * while the models slot stays editable (R5.3).
 */
export const ProviderPanel = (props: ProviderPanelProps): JSX.Element => {
  const { provider, isApiKeySet, useOnlyEnvVars, children } = props;
  const { t } = useTranslation('admin');
  const { register, control } = useFormContext<AiSettingsFormValues>();

  const enabledId = useId();
  const apiKeyId = useId();

  // Nested per-provider paths. Typed as FieldPath so `register` accepts the
  // runtime-composed template without an `as any` escape (the template's union
  // of concrete paths is a valid FieldPath of the form).
  const enabledPath =
    `providers.${provider}.enabled` as FieldPath<AiSettingsFormValues>;
  const apiKeyPath =
    `providers.${provider}.apiKey` as FieldPath<AiSettingsFormValues>;

  // Watch the provider slots so the misconfiguration warning reacts to unsaved
  // edits (toggle / typed key / azure endpoint). Availability is computed through
  // the SAME pure rule the server uses, so the warning cannot drift from what the
  // server would exclude. `hasApiKey` = the saved-key flag OR a non-empty typed
  // key in the form.
  const providers = useWatch<AiSettingsFormValues, 'providers'>({
    control,
    name: 'providers',
  });
  const providerFormValue = providers?.[provider];
  const availability = evaluateProviderAvailability({
    provider,
    enabled: providerFormValue?.enabled === true,
    hasApiKey: isApiKeySet || (providerFormValue?.apiKey ?? '').trim() !== '',
    azureOpenaiSettings: providerFormValue?.azureOpenaiSettings,
  });
  // Only enabled-but-misconfigured providers warrant an inline warning; a disabled
  // provider is admin intent, and an available one needs nothing. The narrowed
  // reason (undefined otherwise) drives both the visibility and the message.
  const misconfiguredReason =
    !availability.available && availability.reason !== 'disabled'
      ? availability.reason
      : undefined;

  return (
    // `mt-3`: the panel mounts directly under the provider tab bar; without a top
    // gap the enable toggle sits too close to the tabs.
    <div className="mt-3">
      <FormGroup switch className="mb-3">
        <Input
          id={enabledId}
          type="switch"
          role="switch"
          disabled={useOnlyEnvVars}
          {...registerToInputProps(register(enabledPath))}
        />
        <Label htmlFor={enabledId} className="ms-2 fw-bold">
          {t('ai_settings.provider_enabled_label')}
        </Label>
      </FormGroup>

      {misconfiguredReason != null && (
        <Alert
          color="warning"
          fade={false}
          className="mb-3"
          data-testid="provider-misconfigured-warning"
        >
          {misconfiguredReason === 'missing-azure-endpoint'
            ? t('ai_settings.provider_warning_missing_azure_endpoint')
            : t('ai_settings.provider_warning_missing_api_key')}
        </Alert>
      )}

      <FormGroup className="mb-3">
        <div className="d-flex align-items-center gap-2 mb-1">
          <Label for={apiKeyId} className="mb-0 fw-bold">
            {t('ai_settings.api_key_label')}
          </Label>
          {isApiKeySet ? (
            <Badge color="success" pill data-testid="provider-api-key-status">
              {t('ai_settings.api_key_set_chip')}
            </Badge>
          ) : (
            <Badge color="secondary" pill data-testid="provider-api-key-status">
              {t('ai_settings.api_key_not_set_chip')}
            </Badge>
          )}
        </div>
        {/* Help text sits directly under the label (above the input), matching
            the Models / Default model sections' description placement. */}
        <p className="form-text text-muted mt-0 mb-2">
          {t('ai_settings.api_key_help')}
        </p>
        <Input
          id={apiKeyId}
          type="password"
          disabled={useOnlyEnvVars}
          autoComplete="new-password"
          placeholder={
            isApiKeySet ? t('ai_settings.api_key_set_placeholder') : ''
          }
          {...registerToInputProps(register(apiKeyPath))}
        />
      </FormGroup>

      {/* Models slot: the caller injects the provider-scoped AllowedModelsField
          here (task 6.5). NOT disabled by env-only — model editing stays active
          (R5.3); the child manages its own disabled state. */}
      {children}

      {provider === 'azure-openai' && (
        <AzureOpenaiSettings disabled={useOnlyEnvVars} />
      )}
    </div>
  );
};
