import type { JSX } from 'react';
import { useCallback, useId } from 'react';
import { useTranslation } from 'next-i18next';
import { Alert, FormGroup, FormText, Input, Label } from 'reactstrap';

import type { AiProvider } from '../../interfaces/ai-provider';

export interface AzureOpenaiSettingsProps {
  /** Current `ai:provider`; the section is hidden unless this is azure-openai (3.2). */
  readonly provider?: AiProvider;
  /** Current `ai:azureOpenaiResourceName` value. */
  readonly resourceName: string;
  /** Current `ai:azureOpenaiBaseUrl` value. */
  readonly baseUrl: string;
  /** Current `ai:azureOpenaiApiVersion` value. */
  readonly apiVersion: string;
  /** Current `ai:azureOpenaiUseEntraId` value. */
  readonly useEntraId: boolean;
  /** Disable/read-only the inputs when env-only mode is active (4.2). */
  readonly disabled: boolean;
  readonly onChangeResourceName: (next: string) => void;
  readonly onChangeBaseUrl: (next: string) => void;
  readonly onChangeApiVersion: (next: string) => void;
  readonly onChangeUseEntraId: (next: boolean) => void;
}

/**
 * Presentational, controlled form for the Azure OpenAI connection settings (3.1).
 *
 * Renders nothing unless `provider === 'azure-openai'` (3.2). When
 * `useEntraId` is on, surfaces a note that the apiKey is not used (3.3) — the
 * apiKey field itself lives in `ProviderCommonSettings`. Also notes that the
 * model field is a deployment name rather than a model id (3.4).
 */
export const AzureOpenaiSettings = (
  props: AzureOpenaiSettingsProps,
): JSX.Element | null => {
  const {
    provider,
    resourceName,
    baseUrl,
    apiVersion,
    useEntraId,
    disabled,
    onChangeResourceName,
    onChangeBaseUrl,
    onChangeApiVersion,
    onChangeUseEntraId,
  } = props;
  const { t } = useTranslation('admin');

  const resourceNameId = useId();
  const baseUrlId = useId();
  const apiVersionId = useId();
  const useEntraIdId = useId();

  const handleUseEntraIdChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChangeUseEntraId(e.target.checked);
    },
    [onChangeUseEntraId],
  );

  if (provider !== 'azure-openai') {
    return null;
  }

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
          value={resourceName}
          disabled={disabled}
          onChange={(e) => onChangeResourceName(e.target.value)}
        />
      </FormGroup>

      <FormGroup className="mb-3">
        <Label for={baseUrlId}>{t('ai_settings.azure_base_url_label')}</Label>
        <Input
          id={baseUrlId}
          type="text"
          value={baseUrl}
          disabled={disabled}
          onChange={(e) => onChangeBaseUrl(e.target.value)}
        />
      </FormGroup>

      <FormGroup className="mb-3">
        <Label for={apiVersionId}>
          {t('ai_settings.azure_api_version_label')}
        </Label>
        <Input
          id={apiVersionId}
          type="text"
          value={apiVersion}
          disabled={disabled}
          onChange={(e) => onChangeApiVersion(e.target.value)}
        />
      </FormGroup>

      <FormGroup switch className="mb-3">
        <Input
          id={useEntraIdId}
          type="switch"
          role="switch"
          checked={useEntraId}
          disabled={disabled}
          onChange={handleUseEntraIdChange}
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
