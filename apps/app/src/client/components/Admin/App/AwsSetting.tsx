import type { JSX } from 'react';

import { useTranslation } from 'next-i18next';
import type { UseFormRegister } from 'react-hook-form';

import type { FileUploadFormValues } from './FileUploadSetting.types';

export type AwsSettingMoleculeProps = {
  register: UseFormRegister<FileUploadFormValues>
  s3ReferenceFileWithRelayMode: boolean
  onChangeS3ReferenceFileWithRelayMode: (val: boolean) => void
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
                onClick={() => { props.onChangeS3ReferenceFileWithRelayMode(true) }}
              >
                {t('admin:app_setting.file_delivery_method_relay')}
              </button>
              <button
                className="dropdown-item"
                type="button"
                onClick={() => { props.onChangeS3ReferenceFileWithRelayMode(false) }}
              >
                {t('admin:app_setting.file_delivery_method_redirect')}
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
            {...props.register('s3Region')}
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
            {...props.register('s3CustomEndpoint')}
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
            {...props.register('s3Bucket')}
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
            {...props.register('s3AccessKeyId')}
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
            {...props.register('s3SecretAccessKey')}
          />
          <p className="form-text text-muted">{t('admin:app_setting.s3_secret_access_key_input_description')}</p>
        </div>
      </div>
    </>
  );
};
