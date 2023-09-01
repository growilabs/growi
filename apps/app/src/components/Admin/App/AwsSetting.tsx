import { useTranslation } from 'next-i18next';

export type AwsSettingMoleculeProps = {
  s3ReferenceFileWithRelayMode
  s3Region
  s3CustomEndpoint
  s3Bucket
  s3AccessKeyId
  s3SecretAccessKey
  onChangeS3ReferenceFileWithRelayMode: (val: boolean) => void
  onChangeS3Region: (val: string) => void
  onChangeS3CustomEndpoint: (val: string) => void
  onChangeS3Bucket: (val: string) => void
  onChangeS3AccessKeyId: (val: string) => void
  onChangeS3SecretAccessKey: (val: string) => void
};

export const AwsSettingMolecule = (props: AwsSettingMoleculeProps): JSX.Element => {
  const { t } = useTranslation();

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
              id="ddS3ReferenceFileWithRelayMode"
              data-bs-toggle="dropdown"
              aria-haspopup="true"
              aria-expanded="true"
            >
              {props.s3ReferenceFileWithRelayMode && t('admin:app_setting.file_delivery_method_relay')}
              {!props.s3ReferenceFileWithRelayMode && t('admin:app_setting.file_delivery_method_redirect')}
            </button>
            <div className="dropdown-menu" aria-labelledby="ddS3ReferenceFileWithRelayMode">
              <button
                className="dropdown-item"
                type="button"
                onClick={() => { props?.onChangeS3ReferenceFileWithRelayMode(true) }}
              >
                {t('admin:app_setting.file_delivery_method_relay')}
              </button>
              <button
                className="dropdown-item"
                type="button"
                onClick={() => { props?.onChangeS3ReferenceFileWithRelayMode(false) }}
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

      <div className="row">
        <label className="text-start text-md-end col-md-3 col-form-label">
          {t('admin:app_setting.region')}
        </label>
        <div className="col-md-6">
          <input
            className="form-control"
            placeholder={`${t('eg')} ap-northeast-1`}
            defaultValue={props.s3Region || ''}
            onChange={(e) => {
              props?.onChangeS3Region(e.target.value);
            }}
          />
        </div>
      </div>

      <div className="row">
        <label className="text-start text-md-end col-md-3 col-form-label">
          {t('admin:app_setting.custom_endpoint')}
        </label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            placeholder={`${t('eg')} http://localhost:9000`}
            defaultValue={props.s3CustomEndpoint || ''}
            onChange={(e) => {
              props?.onChangeS3CustomEndpoint(e.target.value);
            }}
          />
          <p className="form-text text-muted">{t('admin:app_setting.custom_endpoint_change')}</p>
        </div>
      </div>

      <div className="row">
        <label className="text-start text-md-end col-md-3 col-form-label">
          {t('admin:app_setting.bucket_name')}
        </label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            placeholder={`${t('eg')} crowi`}
            defaultValue={props.s3Bucket || ''}
            onChange={(e) => {
              props.onChangeS3Bucket(e.target.value);
            }}
          />
        </div>
      </div>

      <div className="row">
        <label className="text-start text-md-end col-md-3 col-form-label">
          Access key ID
        </label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            defaultValue={props.s3AccessKeyId || ''}
            onChange={(e) => {
              props?.onChangeS3AccessKeyId(e.target.value);
            }}
          />
        </div>
      </div>

      <div className="row">
        <label className="text-start text-md-end col-md-3 col-form-label">
          Secret access key
        </label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            onChange={(e) => {
              props?.onChangeS3SecretAccessKey(e.target.value);
            }}
          />
          <p className="form-text text-muted">{t('admin:app_setting.s3_secret_access_key_input_description')}</p>
        </div>
      </div>


    </>
  );
};
