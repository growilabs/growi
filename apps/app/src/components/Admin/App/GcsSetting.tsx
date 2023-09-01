import { useTranslation } from 'next-i18next';

export type GcsSettingMoleculeProps = {
  gcsReferenceFileWithRelayMode
  gcsUseOnlyEnvVars
  gcsApiKeyJsonPath
  gcsBucket
  gcsUploadNamespace
  envGcsApiKeyJsonPath?
  envGcsBucket?
  envGcsUploadNamespace?
  onChangeGcsReferenceFileWithRelayMode: (val: boolean) => void
  onChangeGcsApiKeyJsonPath: (val: string) => void
  onChangeGcsBucket: (val: string) => void
  onChangeGcsUploadNamespace: (val: string) => void
};

export const GcsSettingMolecule = (props: GcsSettingMoleculeProps): JSX.Element => {
  const { t } = useTranslation();

  const {
    gcsReferenceFileWithRelayMode,
    gcsUseOnlyEnvVars,
    gcsApiKeyJsonPath,
    envGcsApiKeyJsonPath,
    gcsBucket,
    envGcsBucket,
    gcsUploadNamespace,
    envGcsUploadNamespace,
  } = props;

  return (
    <>

      <div className="row my-3">
        <label className="text-start text-md-end col-md-3 col-form-label">
          {t('admin:app_setting.file_delivery_method')}
        </label>

        <div className="col-md-6">
          <div className="dropdown">
            <button
              className="btn btn-outline-secondary dropdown-toggle"
              type="button"
              id="ddGcsReferenceFileWithRelayMode"
              data-bs-toggle="dropdown"
              aria-haspopup="true"
              aria-expanded="true"
            >
              {gcsReferenceFileWithRelayMode && t('admin:app_setting.file_delivery_method_relay')}
              {!gcsReferenceFileWithRelayMode && t('admin:app_setting.file_delivery_method_redirect')}
            </button>
            <div className="dropdown-menu" aria-labelledby="ddGcsReferenceFileWithRelayMode">
              <button
                className="dropdown-item"
                type="button"
                onClick={() => { props?.onChangeGcsReferenceFileWithRelayMode(true) }}
              >
                {t('admin:app_setting.file_delivery_method_relay')}
              </button>
              <button
                className="dropdown-item"
                type="button"
                onClick={() => { props?.onChangeGcsReferenceFileWithRelayMode(false) }}
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

      {gcsUseOnlyEnvVars && (
        <p
          className="alert alert-info"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: t('admin:app_setting.note_for_the_only_env_option', { env: 'GCS_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS' }) }}
        />
      )}
      <table className={`table settings-table ${gcsUseOnlyEnvVars && 'use-only-env-vars'}`}>
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
            <th>Api Key Json Path</th>
            <td>
              <input
                className="form-control"
                type="text"
                name="gcsApiKeyJsonPath"
                readOnly={gcsUseOnlyEnvVars}
                defaultValue={gcsApiKeyJsonPath}
                onChange={e => props?.onChangeGcsApiKeyJsonPath(e.target.value)}
              />
            </td>
            <td>
              <input className="form-control" type="text" value={envGcsApiKeyJsonPath || ''} readOnly tabIndex={-1} />
              <p className="form-text text-muted">
                {/* eslint-disable-next-line react/no-danger */}
                <small dangerouslySetInnerHTML={{ __html: t('admin:app_setting.use_env_var_if_empty', { variable: 'GCS_API_KEY_JSON_PATH' }) }} />
              </p>
            </td>
          </tr>
          <tr>
            <th>{t('admin:app_setting.bucket_name')}</th>
            <td>
              <input
                className="form-control"
                type="text"
                name="gcsBucket"
                readOnly={gcsUseOnlyEnvVars}
                defaultValue={gcsBucket}
                onChange={e => props?.onChangeGcsBucket(e.target.value)}
              />
            </td>
            <td>
              <input className="form-control" type="text" value={envGcsBucket || ''} readOnly tabIndex={-1} />
              <p className="form-text text-muted">
                {/* eslint-disable-next-line react/no-danger */}
                <small dangerouslySetInnerHTML={{ __html: t('admin:app_setting.use_env_var_if_empty', { variable: 'GCS_BUCKET' }) }} />
              </p>
            </td>
          </tr>
          <tr>
            <th>Name Space</th>
            <td>
              <input
                className="form-control"
                type="text"
                name="gcsUploadNamespace"
                readOnly={gcsUseOnlyEnvVars}
                defaultValue={gcsUploadNamespace}
                onChange={e => props?.onChangeGcsUploadNamespace(e.target.value)}
              />
            </td>
            <td>
              <input className="form-control" type="text" value={envGcsUploadNamespace || ''} readOnly tabIndex={-1} />
              <p className="form-text text-muted">
                {/* eslint-disable-next-line react/no-danger */}
                <small dangerouslySetInnerHTML={{ __html: t('admin:app_setting.use_env_var_if_empty', { variable: 'GCS_UPLOAD_NAMESPACE' }) }} />
              </p>
            </td>
          </tr>
        </tbody>
      </table>

    </>
  );
};
