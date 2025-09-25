import type { JSX } from 'react';

import { useTranslation } from 'next-i18next';

import MaskedInput from './MaskedInput';


export type AzureSettingMoleculeProps = {
  azureReferenceFileWithRelayMode
  azureUseOnlyEnvVars
  azureTenantId
  azureClientId
  azureClientSecret
  azureStorageAccountName
  azureStorageContainerName
  envAzureTenantId?
  envAzureClientId?
  envAzureClientSecret?
  envAzureStorageAccountName?
  envAzureStorageContainerName?
  onChangeAzureReferenceFileWithRelayMode: (val: boolean) => void
  onChangeAzureTenantId: (val: string) => void
  onChangeAzureClientId: (val: string) => void
  onChangeAzureClientSecret: (val: string) => void
  onChangeAzureStorageAccountName: (val: string) => void
  onChangeAzureStorageContainerName: (val: string) => void
};

export const AzureSettingMolecule = (props: AzureSettingMoleculeProps): JSX.Element => {
  const { t } = useTranslation();

  const {
    azureReferenceFileWithRelayMode,
    azureUseOnlyEnvVars,
    azureTenantId,
    azureClientId,
    azureClientSecret,
    azureStorageAccountName,
    envAzureTenantId,
    envAzureClientId,
    envAzureClientSecret,
    envAzureStorageAccountName,
    azureStorageContainerName,
    envAzureStorageContainerName,
  } = props;

  return (
    <>

      <div className="row form-group my-3">
        <label className="text-left text-md-right col-md-3 col-form-label">
          {t('admin:app_setting.file_delivery_method')}
        </label>

        <div className="col-md-6">
          <div className="dropdown">
            <button
              className="btn btn-outline-secondary dropdown-toggle"
              type="button"
              id="ddAzureReferenceFileWithRelayMode"
              data-toggle="dropdown"
              aria-haspopup="true"
              aria-expanded="true"
            >
              {azureReferenceFileWithRelayMode && t('admin:app_setting.file_delivery_method_relay')}
              {!azureReferenceFileWithRelayMode && t('admin:app_setting.file_delivery_method_redirect')}
            </button>
            <div className="dropdown-menu" aria-labelledby="ddAzureReferenceFileWithRelayMode">
              <button
                className="dropdown-item"
                type="button"
                onClick={() => { props?.onChangeAzureReferenceFileWithRelayMode(true) }}
              >
                {t('admin:app_setting.file_delivery_method_relay')}
              </button>
              <button
                className="dropdown-item"
                type="button"
                onClick={() => { props?.onChangeAzureReferenceFileWithRelayMode(false) }}
              >
                { t('admin:app_setting.file_delivery_method_redirect')}
              </button>
            </div>

            <p className="form-text text-muted small">
              {t('admin:app_setting.file_delivery_method_redirect_info')}
              <br />
              {t('admin:app_setting.file_delivery_method_relay_info')}
            </p>
          </div>
        </div>
      </div>

      {azureUseOnlyEnvVars && (
        <p
          className="alert alert-info"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: t('admin:app_setting.azure_note_for_the_only_env_option', { env: 'AZURE_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS' }) }}
        />
      )}
      <table className={`table settings-table ${azureUseOnlyEnvVars && 'use-only-env-vars'}`}>
        <colgroup>
          <col className="item-name" />
          <col className="from-db" />
          <col className="from-env-vars" />
        </colgroup>
        <thead>
          <tr>
            <th></th>
            <th>Database</th>
            <th>Environment variables</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>{t('admin:app_setting.azure_tenant_id')}</th>
            <td>
              <MaskedInput
                name="azureTenantId"
                readOnly={azureUseOnlyEnvVars}
                value={azureTenantId}
                onChange={e => props?.onChangeAzureTenantId(e.target.value)}
              />
            </td>
            <td>
              <MaskedInput name="envAzureTenantId" value={envAzureTenantId || ''} readOnly tabIndex={-1} />
              <p className="form-text text-muted">
                {/* eslint-disable-next-line react/no-danger */}
                <small dangerouslySetInnerHTML={{ __html: t('admin:app_setting.use_env_var_if_empty', { variable: 'AZURE_TENANT_ID' }) }} />
              </p>
            </td>
          </tr>
          <tr>
            <th>{t('admin:app_setting.azure_client_id')}</th>
            <td>
              <MaskedInput
                name="azureClientId"
                readOnly={azureUseOnlyEnvVars}
                value={azureClientId}
                onChange={e => props?.onChangeAzureClientId(e.target.value)}
              />
            </td>
            <td>
              <MaskedInput name="envAzureClientId" value={envAzureClientId || ''} readOnly tabIndex={-1} />
              <p className="form-text text-muted">
                {/* eslint-disable-next-line react/no-danger */}
                <small dangerouslySetInnerHTML={{ __html: t('admin:app_setting.use_env_var_if_empty', { variable: 'AZURE_CLIENT_ID' }) }} />
              </p>
            </td>
          </tr>
          <tr>
            <th>{t('admin:app_setting.azure_client_secret')}</th>
            <td>
              <MaskedInput
                name="azureClientSecret"
                readOnly={azureUseOnlyEnvVars}
                value={azureClientSecret}
                onChange={e => props?.onChangeAzureClientSecret(e.target.value)}
              />
            </td>
            <td>
              <MaskedInput name="envAzureClientSecret" value={envAzureClientSecret || ''} readOnly tabIndex={-1} />
              <p className="form-text text-muted">
                {/* eslint-disable-next-line react/no-danger */}
                <small dangerouslySetInnerHTML={{ __html: t('admin:app_setting.use_env_var_if_empty', { variable: 'AZURE_CLIENT_SECRET' }) }} />
              </p>
            </td>
          </tr>
          <tr>
            <th>{t('admin:app_setting.azure_storage_account_name')}</th>
            <td>
              <input
                className="form-control"
                type="text"
                name="azureStorageAccountName"
                readOnly={azureUseOnlyEnvVars}
                value={azureStorageAccountName}
                onChange={e => props?.onChangeAzureStorageAccountName(e.target.value)}
              />
            </td>
            <td>
              <input className="form-control" type="text" value={envAzureStorageAccountName || ''} readOnly tabIndex={-1} />
              <p className="form-text text-muted">
                {/* eslint-disable-next-line react/no-danger */}
                <small dangerouslySetInnerHTML={{ __html: t('admin:app_setting.use_env_var_if_empty', { variable: 'AZURE_STORAGE_ACCOUNT_NAME' }) }} />
              </p>
            </td>
          </tr>
          <tr>
            <th>{t('admin:app_setting.azure_storage_container_name')}</th>
            <td>
              <input
                className="form-control"
                type="text"
                name="azureStorageContainerName"
                readOnly={azureUseOnlyEnvVars}
                value={azureStorageContainerName}
                onChange={e => props?.onChangeAzureStorageContainerName(e.target.value)}
              />
            </td>
            <td>
              <input className="form-control" type="text" value={envAzureStorageContainerName || ''} readOnly tabIndex={-1} />
              <p className="form-text text-muted">
                {/* eslint-disable-next-line react/no-danger */}
                <small dangerouslySetInnerHTML={{ __html: t('admin:app_setting.use_env_var_if_empty', { variable: 'AZURE_STORAGE_CONTAINER_NAME' }) }} />
              </p>
            </td>
          </tr>
        </tbody>
      </table>

    </>
  );
};
