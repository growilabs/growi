import type { JSX } from 'react';
import { useId } from 'react';
import { useTranslation } from 'next-i18next';
import { useFormContext } from 'react-hook-form';
import { Alert, FormGroup, FormText, Input, Label } from 'reactstrap';

import type { AiSettingsFormValues } from './ai-settings-form-values';
import { registerToInputProps } from './register-to-input-props';

export interface AzureOpenaiSettingsProps {
  /** Disable the inputs when env-only mode is active (4.2). */
  readonly disabled: boolean;
}

/**
 * Register-based form for the Azure OpenAI connection settings (3.1).
 *
 * Reads/writes the shared react-hook-form context owned by `AiSettings`. Renders
 * nothing unless the watched `provider === 'azure-openai'` (3.2). When
 * `azureOpenaiUseEntraId` is on, surfaces a note that the apiKey is not used
 * (3.3) — the apiKey field itself lives in `ProviderCommonSettings`. Also notes
 * that the model field is a deployment name rather than a model id (3.4).
 */
export const AzureOpenaiSettings = (
  props: AzureOpenaiSettingsProps,
): JSX.Element | null => {
  const { disabled } = props;
  const { t } = useTranslation('admin');
  const { register, watch } = useFormContext<AiSettingsFormValues>();

  const resourceNameId = useId();
  const baseUrlId = useId();
  const apiVersionId = useId();
  const useEntraIdId = useId();

  if (watch('provider') !== 'azure-openai') {
    return null;
  }

  const useEntraId = watch('azureOpenaiUseEntraId');

  return (
    <div>
      <FormText tag="p" className="mb-3">
        {t('ai_settings.azure_model_deployment_note')}
      </FormText>

      <FormGroup className="mb-3">
        <Label for={resourceNameId}>
          {t('ai_settings.azure_resource_name_label')}
        </Label>
        <Input
          id={resourceNameId}
          type="text"
          disabled={disabled}
          {...registerToInputProps(register('azureOpenaiResourceName'))}
        />
      </FormGroup>

      <FormGroup className="mb-3">
        <Label for={baseUrlId}>{t('ai_settings.azure_base_url_label')}</Label>
        <Input
          id={baseUrlId}
          type="text"
          disabled={disabled}
          {...registerToInputProps(register('azureOpenaiBaseUrl'))}
        />
      </FormGroup>

      <FormGroup className="mb-3">
        <Label for={apiVersionId}>
          {t('ai_settings.azure_api_version_label')}
        </Label>
        <Input
          id={apiVersionId}
          type="text"
          disabled={disabled}
          {...registerToInputProps(register('azureOpenaiApiVersion'))}
        />
      </FormGroup>

      <FormGroup switch className="mb-3">
        <Input
          id={useEntraIdId}
          type="switch"
          role="switch"
          disabled={disabled}
          {...registerToInputProps(register('azureOpenaiUseEntraId'))}
        />
        <Label htmlFor={useEntraIdId} className="ms-2">
          {t('ai_settings.azure_use_entra_id_label')}
        </Label>
      </FormGroup>

      {useEntraId && (
        <Alert color="info" className="mb-3">
          {t('ai_settings.azure_entra_id_api_key_note')}
        </Alert>
      )}
    </div>
  );
};
