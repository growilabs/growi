import type { JSX } from 'react';
import { useId } from 'react';
import { useTranslation } from 'next-i18next';
import { useFormContext } from 'react-hook-form';
import { Alert, FormGroup, FormText, Input, Label } from 'reactstrap';

import type { AiSettingsFormValues } from './ai-settings-form-values';
import { registerToInputProps } from './register-to-input-props';

export interface AzureOpenaiSettingsProps {
  /** Disable the inputs when env-only mode is active (5.2). */
  readonly disabled: boolean;
}

/**
 * Register-based form for the Azure OpenAI connection settings (1.10).
 *
 * Reads/writes the shared react-hook-form context owned by `AiSettings`, binding
 * every field under the azure-openai provider slot
 * (`providers.azure-openai.azureOpenaiSettings.*`). It renders unconditionally:
 * the caller (`ProviderPanel`) mounts it ONLY inside the azure-openai panel, so
 * the section no longer self-gates on a global `provider` (that field no longer
 * exists on the multi-provider form). This section holds only the Azure
 * *connection* settings (resource name / base URL / API version / Entra ID); the
 * deployment-name field lives in the shared `AllowedModelsField`, which labels it
 * as the deployment name for this provider. When `useEntraId` is on, surfaces a
 * note that the apiKey is not used (1.10) — the apiKey field itself lives in
 * `ProviderPanel`.
 *
 * Azure is the most configuration-heavy provider (resource name vs. base URL,
 * optional API version, two auth methods), so each field carries inline help and
 * the Entra ID note spells out how credentials are resolved — managed/workload
 * identity when GROWI runs on Azure, environment variables otherwise.
 */
export const AzureOpenaiSettings = (
  props: AzureOpenaiSettingsProps,
): JSX.Element => {
  const { disabled } = props;
  const { t } = useTranslation('admin');
  const { register, watch } = useFormContext<AiSettingsFormValues>();

  const resourceNameId = useId();
  const baseUrlId = useId();
  const apiVersionId = useId();
  const useEntraIdId = useId();

  const useEntraId = watch(
    'providers.azure-openai.azureOpenaiSettings.useEntraId',
  );

  return (
    <div>
      {/* Tab-panel subsection heading — same level as the "Models" section, so it
          uses the identical fs-5 fw-bold. Was an <h2>.admin-setting-header, which
          rendered at the <h2> size (~2rem) and clashed with the page title. */}
      <h3 className="fs-5 fw-bold mt-4 mb-2">
        {t('ai_settings.azure_section_title')}
      </h3>

      <FormGroup className="mb-3">
        <Label for={resourceNameId} className="fw-bold">
          {t('ai_settings.azure_resource_name_label')}
        </Label>
        <Input
          id={resourceNameId}
          type="text"
          disabled={disabled}
          {...registerToInputProps(
            register('providers.azure-openai.azureOpenaiSettings.resourceName'),
          )}
        />
        <FormText>{t('ai_settings.azure_resource_name_help')}</FormText>
      </FormGroup>

      <FormGroup className="mb-3">
        <Label for={baseUrlId} className="fw-bold">
          {t('ai_settings.azure_base_url_label')}
        </Label>
        <Input
          id={baseUrlId}
          type="text"
          disabled={disabled}
          {...registerToInputProps(
            register('providers.azure-openai.azureOpenaiSettings.baseURL'),
          )}
        />
        <FormText>{t('ai_settings.azure_base_url_help')}</FormText>
      </FormGroup>

      <FormGroup className="mb-3">
        <Label for={apiVersionId} className="fw-bold">
          {t('ai_settings.azure_api_version_label')}
        </Label>
        <Input
          id={apiVersionId}
          type="text"
          disabled={disabled}
          {...registerToInputProps(
            register('providers.azure-openai.azureOpenaiSettings.apiVersion'),
          )}
        />
        <FormText>{t('ai_settings.azure_api_version_help')}</FormText>
      </FormGroup>

      <FormGroup switch className="mb-3">
        <Input
          id={useEntraIdId}
          type="switch"
          role="switch"
          disabled={disabled}
          {...registerToInputProps(
            register('providers.azure-openai.azureOpenaiSettings.useEntraId'),
          )}
        />
        <Label htmlFor={useEntraIdId} className="ms-2 fw-bold">
          {t('ai_settings.azure_use_entra_id_label')}
        </Label>
      </FormGroup>

      {useEntraId && (
        <Alert color="info" className="mb-3">
          <p className="mb-2">{t('ai_settings.azure_entra_id_api_key_note')}</p>
          <p className="mb-2">
            {t('ai_settings.azure_entra_id_credential_note')}
          </p>
          <ul className="mb-0 ps-3">
            <li>{t('ai_settings.azure_entra_id_managed_identity_note')}</li>
            <li>
              {t('ai_settings.azure_entra_id_env_note')}
              <span className="d-block mt-1">
                <code>AZURE_TENANT_ID</code> / <code>AZURE_CLIENT_ID</code> /{' '}
                <code>AZURE_CLIENT_SECRET</code>
              </span>
            </li>
          </ul>
        </Alert>
      )}
    </div>
  );
};
