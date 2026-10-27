import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';
import type { UseFormRegister } from 'react-hook-form';

import type { FileUploadFormValues } from './FileUploadSetting.types';

export type AwsSettingMoleculeProps = {
  register: UseFormRegister<FileUploadFormValues>;
  awsUseOnlyEnvVars: boolean;
  s3ReferenceFileWithRelayMode: boolean;
  onChangeS3ReferenceFileWithRelayMode: (val: boolean) => void;
};

export const AwsSettingMolecule = (
  props: AwsSettingMoleculeProps,
): JSX.Element => {
  const { t } = useTranslation();

  return (
    <>
      {props.awsUseOnlyEnvVars && (
        <p
          className="alert alert-info"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: fixed translation with a constant environment variable name
          dangerouslySetInnerHTML={{
            __html: t('admin:app_setting.fixed_by_env_var', {
              envKey: 'AWS_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS',
              envVar: 'true',
            }),
          }}
        />
      )}
      <div className="row my-3">
        <span className="text-start text-md-end col-md-3 col-form-label">
          {t('admin:app_setting.file_delivery_method')}
        </span>

        <div className="col-md-6">
          <div className="dropdown">
            <button
              className="btn btn-outline-secondary dropdown-toggle"
              type="button"
              id="ddS3ReferenceFileWithRelayMode"
              data-bs-toggle="dropdown"
              aria-haspopup="true"
              aria-expanded="true"
              disabled={props.awsUseOnlyEnvVars}
            >
              {props.s3ReferenceFileWithRelayMode &&
                t('admin:app_setting.file_delivery_method_relay')}
              {!props.s3ReferenceFileWithRelayMode &&
                t('admin:app_setting.file_delivery_method_redirect')}
            </button>
            <div className="dropdown-menu">
              <button
                className="dropdown-item"
                disabled={props.awsUseOnlyEnvVars}
                type="button"
                onClick={() => {
                  props.onChangeS3ReferenceFileWithRelayMode(true);
                }}
              >
                {t('admin:app_setting.file_delivery_method_relay')}
              </button>
              <button
                className="dropdown-item"
                disabled={props.awsUseOnlyEnvVars}
                type="button"
                onClick={() => {
                  props.onChangeS3ReferenceFileWithRelayMode(false);
                }}
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
        <label
          className="text-start text-md-end col-md-3 col-form-label"
          htmlFor="admin-aws-setting-region"
        >
          {t('admin:app_setting.region')}
        </label>
        <div className="col-md-6">
          <input
            className="form-control"
            placeholder={`${t('commons:eg')} ap-northeast-1`}
            id="admin-aws-setting-region"
            readOnly={props.awsUseOnlyEnvVars}
            {...props.register('s3Region')}
          />
        </div>
      </div>

      <div className="row">
        <label
          className="text-start text-md-end col-md-3 col-form-label"
          htmlFor="admin-aws-setting-custom-endpoint"
        >
          {t('admin:app_setting.custom_endpoint')}
        </label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            placeholder={`${t('commons:eg')} http://localhost:9000`}
            id="admin-aws-setting-custom-endpoint"
            readOnly={props.awsUseOnlyEnvVars}
            {...props.register('s3CustomEndpoint')}
          />
          <p className="form-text text-muted">
            {t('admin:app_setting.custom_endpoint_change')}
          </p>
        </div>
      </div>

      <div className="row">
        <label
          className="text-start text-md-end col-md-3 col-form-label"
          htmlFor="admin-aws-setting-bucket-name"
        >
          {t('admin:app_setting.bucket_name')}
        </label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            placeholder={`${t('commons:eg')} crowi`}
            id="admin-aws-setting-bucket-name"
            readOnly={props.awsUseOnlyEnvVars}
            {...props.register('s3Bucket')}
          />
        </div>
      </div>

      <div className="row">
        <label
          className="text-start text-md-end col-md-3 col-form-label"
          htmlFor="admin-aws-setting-access-key-id"
        >
          Access key ID
        </label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            id="admin-aws-setting-access-key-id"
            readOnly={props.awsUseOnlyEnvVars}
            {...props.register('s3AccessKeyId')}
          />
        </div>
      </div>

      <div className="row">
        <label
          className="text-start text-md-end col-md-3 col-form-label"
          htmlFor="admin-aws-setting-secret-access-key"
        >
          Secret access key
        </label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            id="admin-aws-setting-secret-access-key"
            readOnly={props.awsUseOnlyEnvVars}
            {...props.register('s3SecretAccessKey')}
          />
          <p className="form-text text-muted">
            {t('admin:app_setting.s3_secret_access_key_input_description')}
          </p>
        </div>
      </div>
    </>
  );
};
