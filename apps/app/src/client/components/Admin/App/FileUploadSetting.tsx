import type { JSX } from 'react';
import { useCallback } from 'react';

import { useTranslation } from 'next-i18next';
import { useForm, useController } from 'react-hook-form';

import { toastSuccess, toastError } from '~/client/util/toastr';
import { FileUploadType } from '~/interfaces/file-uploader';

import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

import { AwsSettingMolecule } from './AwsSetting';
import { AzureSettingMolecule } from './AzureSetting';
import type { FileUploadFormValues } from './FileUploadSetting.types';
import { GcsSettingMolecule } from './GcsSetting';
import { useFileUploadSettings } from './useFileUploadSettings';

const FileUploadSetting = (): JSX.Element => {
  const { t } = useTranslation(['admin', 'commons']);
  const {
    data, isLoading, error, updateSettings,
  } = useFileUploadSettings();

  const {
    register, handleSubmit, control, watch, formState,
  } = useForm<FileUploadFormValues>({
    values: data ? {
      fileUploadType: data.fileUploadType,
      s3Region: data.s3Region,
      s3CustomEndpoint: data.s3CustomEndpoint,
      s3Bucket: data.s3Bucket,
      s3AccessKeyId: data.s3AccessKeyId,
      s3SecretAccessKey: data.s3SecretAccessKey,
      s3ReferenceFileWithRelayMode: data.s3ReferenceFileWithRelayMode,
      gcsApiKeyJsonPath: data.gcsApiKeyJsonPath,
      gcsBucket: data.gcsBucket,
      gcsUploadNamespace: data.gcsUploadNamespace,
      gcsReferenceFileWithRelayMode: data.gcsReferenceFileWithRelayMode,
      azureTenantId: data.azureTenantId,
      azureClientId: data.azureClientId,
      azureClientSecret: data.azureClientSecret,
      azureStorageAccountName: data.azureStorageAccountName,
      azureStorageContainerName: data.azureStorageContainerName,
      azureReferenceFileWithRelayMode: data.azureReferenceFileWithRelayMode,
    } : undefined,
  });

  // Use controller for fileUploadType radio buttons
  const { field: fileUploadTypeField } = useController({
    name: 'fileUploadType',
    control,
  });

  // Use controller for relay mode fields
  const { field: s3RelayModeField } = useController({
    name: 's3ReferenceFileWithRelayMode',
    control,
  });

  const { field: gcsRelayModeField } = useController({
    name: 'gcsReferenceFileWithRelayMode',
    control,
  });

  const { field: azureRelayModeField } = useController({
    name: 'azureReferenceFileWithRelayMode',
    control,
  });

  const fileUploadType = watch('fileUploadType');

  const onSubmit = useCallback(async(formData: FileUploadFormValues) => {
    try {
      await updateSettings(formData, formState.dirtyFields);
      toastSuccess(t('toaster.update_successed', { target: t('admin:app_setting.file_upload_settings'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
  }, [updateSettings, formState.dirtyFields, t]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (error || !data) {
    return <div>Error loading settings</div>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <p className="card custom-card bg-warning-subtle my-3">
        {t('admin:app_setting.file_upload')}
        <span className="text-danger mt-1">
          <span className="material-symbols-outlined">link_off</span>
          {t('admin:app_setting.change_setting')}
        </span>
      </p>

      <div className="row mb-3">
        <label className="text-start text-md-end col-md-3 col-form-label">
          {t('admin:app_setting.file_upload_method')}
        </label>

        <div className="col-md-6 py-2">
          {Object.values(FileUploadType).map((type) => {
            return (
              <div key={type} className="form-check form-check-inline">
                <input
                  type="radio"
                  className="form-check-input"
                  name="file-upload-type"
                  id={`file-upload-type-radio-${type}`}
                  checked={fileUploadTypeField.value === type}
                  disabled={data.isFixedFileUploadByEnvVar}
                  onChange={() => fileUploadTypeField.onChange(type)}
                />
                <label className="form-label form-check-label" htmlFor={`file-upload-type-radio-${type}`}>
                  {t(`admin:app_setting.${type}_label`)}
                </label>
              </div>
            );
          })}
        </div>
        {data.isFixedFileUploadByEnvVar && (
          <p className="alert alert-warning mt-2 text-start offset-3 col-6">
            <span className="material-symbols-outlined">help</span>
            <b>FIXED</b>
            <br />
            {/* eslint-disable-next-line react/no-danger */}
            <b dangerouslySetInnerHTML={{
              __html: t('admin:app_setting.fixed_by_env_var', {
                envKey: 'FILE_UPLOAD',
                envVar: data.envFileUploadType,
              }),
            }}
            />
          </p>
        )}
      </div>

      {fileUploadType === 'aws' && (
        <AwsSettingMolecule
          register={register}
          s3ReferenceFileWithRelayMode={s3RelayModeField.value}
          onChangeS3ReferenceFileWithRelayMode={s3RelayModeField.onChange}
        />
      )}

      {fileUploadType === 'gcs' && (
        <GcsSettingMolecule
          register={register}
          gcsReferenceFileWithRelayMode={gcsRelayModeField.value}
          gcsUseOnlyEnvVars={data.gcsUseOnlyEnvVars}
          envGcsApiKeyJsonPath={data.envGcsApiKeyJsonPath}
          envGcsBucket={data.envGcsBucket}
          envGcsUploadNamespace={data.envGcsUploadNamespace}
          onChangeGcsReferenceFileWithRelayMode={gcsRelayModeField.onChange}
        />
      )}

      {fileUploadType === 'azure' && (
        <AzureSettingMolecule
          register={register}
          azureReferenceFileWithRelayMode={azureRelayModeField.value}
          azureUseOnlyEnvVars={data.azureUseOnlyEnvVars}
          envAzureTenantId={data.envAzureTenantId}
          envAzureClientId={data.envAzureClientId}
          envAzureClientSecret={data.envAzureClientSecret}
          envAzureStorageAccountName={data.envAzureStorageAccountName}
          envAzureStorageContainerName={data.envAzureStorageContainerName}
          onChangeAzureReferenceFileWithRelayMode={azureRelayModeField.onChange}
        />
      )}

      <AdminUpdateButtonRow type="submit" disabled={isLoading} />
    </form>
  );
};

export default FileUploadSetting;
