import type { ChangeEvent, JSX } from 'react';
import React, { useCallback, useEffect } from 'react';

import { useTranslation } from 'next-i18next';
import { useForm } from 'react-hook-form';

import AdminAppContainer from '~/client/services/AdminAppContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { FileUploadType } from '~/interfaces/file-uploader';

import { withUnstatedContainers } from '../../UnstatedUtils';
import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

import { AwsSettingMolecule } from './AwsSetting';
import type { AwsSettingMoleculeProps } from './AwsSetting';
import { AzureSettingMolecule } from './AzureSetting';
import type { AzureSettingMoleculeProps } from './AzureSetting';
import { GcsSettingMolecule } from './GcsSetting';
import type { GcsSettingMoleculeProps } from './GcsSetting';

type FileUploadSettingMoleculeProps = {
  fileUploadType: string
  isFixedFileUploadByEnvVar: boolean
  envFileUploadType?: string
  onChangeFileUploadType: (e: ChangeEvent, type: string) => void
  register: ReturnType<typeof useForm>['register']
} & Omit<AwsSettingMoleculeProps, 'register'> & Omit<GcsSettingMoleculeProps, 'register'> & Omit<AzureSettingMoleculeProps, 'register'>;

export const FileUploadSettingMolecule = React.memo((props: FileUploadSettingMoleculeProps): JSX.Element => {
  const { t } = useTranslation(['admin', 'commons']);

  return (
    <>
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
                  checked={props.fileUploadType === type}
                  disabled={props.isFixedFileUploadByEnvVar}
                  onChange={(e) => { props?.onChangeFileUploadType(e, type) }}
                />
                <label className="form-label form-check-label" htmlFor={`file-upload-type-radio-${type}`}>{t(`admin:app_setting.${type}_label`)}</label>
              </div>
            );
          })}
        </div>
        {props.isFixedFileUploadByEnvVar && (
          <p className="alert alert-warning mt-2 text-start offset-3 col-6">
            <span className="material-symbols-outlined">help</span>
            <b>FIXED</b><br />
            {/* eslint-disable-next-line react/no-danger */}
            <b dangerouslySetInnerHTML={{
              __html: t('admin:app_setting.fixed_by_env_var', {
                envKey: 'FILE_UPLOAD',
                envVar: props.envFileUploadType,
              }),
            }}
            />
          </p>
        )}
      </div>

      {props.fileUploadType === 'aws' && (
        <AwsSettingMolecule
          register={props.register}
          s3ReferenceFileWithRelayMode={props.s3ReferenceFileWithRelayMode}
          s3Region={props.s3Region}
          s3CustomEndpoint={props.s3CustomEndpoint}
          s3Bucket={props.s3Bucket}
          s3AccessKeyId={props.s3AccessKeyId}
          s3SecretAccessKey={props.s3SecretAccessKey}
          onChangeS3ReferenceFileWithRelayMode={props.onChangeS3ReferenceFileWithRelayMode}
          onChangeS3Region={props.onChangeS3Region}
          onChangeS3CustomEndpoint={props.onChangeS3CustomEndpoint}
          onChangeS3Bucket={props.onChangeS3Bucket}
          onChangeS3AccessKeyId={props.onChangeS3AccessKeyId}
          onChangeS3SecretAccessKey={props.onChangeS3SecretAccessKey}
        />
      )}
      {props.fileUploadType === 'gcs' && (
        <GcsSettingMolecule
          register={props.register}
          gcsReferenceFileWithRelayMode={props.gcsReferenceFileWithRelayMode}
          gcsUseOnlyEnvVars={props.gcsUseOnlyEnvVars}
          gcsApiKeyJsonPath={props.gcsApiKeyJsonPath}
          gcsBucket={props.gcsBucket}
          gcsUploadNamespace={props.gcsUploadNamespace}
          envGcsApiKeyJsonPath={props.envGcsApiKeyJsonPath}
          envGcsBucket={props.envGcsBucket}
          envGcsUploadNamespace={props.envGcsUploadNamespace}
          onChangeGcsReferenceFileWithRelayMode={props.onChangeGcsReferenceFileWithRelayMode}
          onChangeGcsApiKeyJsonPath={props.onChangeGcsApiKeyJsonPath}
          onChangeGcsBucket={props.onChangeGcsBucket}
          onChangeGcsUploadNamespace={props.onChangeGcsUploadNamespace}
        />
      )}
      {props.fileUploadType === 'azure' && (
        <AzureSettingMolecule
          register={props.register}
          azureReferenceFileWithRelayMode={props.azureReferenceFileWithRelayMode}
          azureUseOnlyEnvVars={props.azureUseOnlyEnvVars}
          azureTenantId={props.azureTenantId}
          azureClientId={props.azureClientId}
          azureClientSecret={props.azureClientSecret}
          azureStorageAccountName={props.azureStorageAccountName}
          azureStorageContainerName={props.azureStorageContainerName}
          envAzureStorageAccountName={props.envAzureStorageAccountName}
          envAzureStorageContainerName={props.envAzureStorageContainerName}
          envAzureTenantId={props.envAzureTenantId}
          envAzureClientId={props.envAzureClientId}
          envAzureClientSecret={props.envAzureClientSecret}
          onChangeAzureReferenceFileWithRelayMode={props.onChangeAzureReferenceFileWithRelayMode}
          onChangeAzureTenantId={props.onChangeAzureTenantId}
          onChangeAzureClientId={props.onChangeAzureClientId}
          onChangeAzureClientSecret={props.onChangeAzureClientSecret}
          onChangeAzureStorageAccountName={props.onChangeAzureStorageAccountName}
          onChangeAzureStorageContainerName={props.onChangeAzureStorageContainerName}
        />
      )}
    </>
  );
});
FileUploadSettingMolecule.displayName = 'FileUploadSettingMolecule';


type FileUploadSettingProps = {
  adminAppContainer: AdminAppContainer
}

const FileUploadSetting = (props: FileUploadSettingProps): JSX.Element => {
  const { t } = useTranslation(['admin', 'commons']);
  const { adminAppContainer } = props;

  const {
    fileUploadType, isFixedFileUploadByEnvVar, envFileUploadType, retrieveError,
    s3ReferenceFileWithRelayMode,
    s3Region, s3CustomEndpoint, s3Bucket,
    s3AccessKeyId, s3SecretAccessKey,
    gcsReferenceFileWithRelayMode, gcsUseOnlyEnvVars,
    gcsApiKeyJsonPath, envGcsApiKeyJsonPath, gcsBucket,
    envGcsBucket, gcsUploadNamespace, envGcsUploadNamespace,
    azureReferenceFileWithRelayMode, azureUseOnlyEnvVars,
    azureTenantId, azureClientId, azureClientSecret,
    azureStorageAccountName, azureStorageContainerName,
    envAzureTenantId, envAzureClientId, envAzureClientSecret,
    envAzureStorageAccountName, envAzureStorageContainerName,
  } = adminAppContainer.state;

  const { register, handleSubmit, reset } = useForm();

  // Sync form with container state
  useEffect(() => {
    reset({
      s3Region,
      s3CustomEndpoint,
      s3Bucket,
      s3AccessKeyId,
      gcsApiKeyJsonPath,
      gcsBucket,
      gcsUploadNamespace,
      azureTenantId,
      azureClientId,
      azureClientSecret,
      azureStorageAccountName,
      azureStorageContainerName,
    });
  }, [
    reset,
    s3Region, s3CustomEndpoint, s3Bucket, s3AccessKeyId,
    gcsApiKeyJsonPath, gcsBucket, gcsUploadNamespace,
    azureTenantId, azureClientId, azureClientSecret,
    azureStorageAccountName, azureStorageContainerName,
  ]);

  const submitHandler = useCallback(async(data) => {
    try {
      // Update container state with form data
      await adminAppContainer.changeS3Region(data.s3Region ?? '');
      await adminAppContainer.changeS3CustomEndpoint(data.s3CustomEndpoint ?? '');
      await adminAppContainer.changeS3Bucket(data.s3Bucket ?? '');
      await adminAppContainer.changeS3AccessKeyId(data.s3AccessKeyId ?? '');
      await adminAppContainer.changeS3SecretAccessKey(data.s3SecretAccessKey ?? '');
      await adminAppContainer.changeGcsApiKeyJsonPath(data.gcsApiKeyJsonPath ?? '');
      await adminAppContainer.changeGcsBucket(data.gcsBucket ?? '');
      await adminAppContainer.changeGcsUploadNamespace(data.gcsUploadNamespace ?? '');
      await adminAppContainer.changeAzureTenantId(data.azureTenantId ?? '');
      await adminAppContainer.changeAzureClientId(data.azureClientId ?? '');
      await adminAppContainer.changeAzureClientSecret(data.azureClientSecret ?? '');
      await adminAppContainer.changeAzureStorageAccountName(data.azureStorageAccountName ?? '');
      await adminAppContainer.changeAzureStorageContainerName(data.azureStorageContainerName ?? '');

      await adminAppContainer.updateFileUploadSettingHandler();
      toastSuccess(t('toaster.update_successed', { target: t('admin:app_setting.file_upload_settings'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
  }, [adminAppContainer, t]);

  const onChangeFileUploadTypeHandler = useCallback((e: ChangeEvent, type: string) => {
    adminAppContainer.changeFileUploadType(type);
  }, [adminAppContainer]);

  // S3
  const onChangeS3ReferenceFileWithRelayModeHandler = useCallback((val: boolean) => {
    adminAppContainer.changeS3ReferenceFileWithRelayMode(val);
  }, [adminAppContainer]);

  const onChangeS3RegionHandler = useCallback((val: string) => {
    adminAppContainer.changeS3Region(val);
  }, [adminAppContainer]);

  const onChangeS3CustomEndpointHandler = useCallback((val: string) => {
    adminAppContainer.changeS3CustomEndpoint(val);
  }, [adminAppContainer]);

  const onChangeS3BucketHandler = useCallback((val: string) => {
    adminAppContainer.changeS3Bucket(val);
  }, [adminAppContainer]);

  const onChangeS3AccessKeyIdHandler = useCallback((val: string) => {
    adminAppContainer.changeS3AccessKeyId(val);
  }, [adminAppContainer]);

  const onChangeS3SecretAccessKeyHandler = useCallback((val: string) => {
    adminAppContainer.changeS3SecretAccessKey(val);
  }, [adminAppContainer]);

  // GCS
  const onChangeGcsReferenceFileWithRelayModeHandler = useCallback((val: boolean) => {
    adminAppContainer.changeGcsReferenceFileWithRelayMode(val);
  }, [adminAppContainer]);

  const onChangeGcsApiKeyJsonPathHandler = useCallback((val: string) => {
    adminAppContainer.changeGcsApiKeyJsonPath(val);
  }, [adminAppContainer]);

  const onChangeGcsBucketHandler = useCallback((val: string) => {
    adminAppContainer.changeGcsBucket(val);
  }, [adminAppContainer]);

  const onChangeGcsUploadNamespaceHandler = useCallback((val: string) => {
    adminAppContainer.changeGcsUploadNamespace(val);
  }, [adminAppContainer]);

  // Azure
  const onChangeAzureReferenceFileWithRelayModeHandler = useCallback((val: boolean) => {
    adminAppContainer.changeAzureReferenceFileWithRelayMode(val);
  }, [adminAppContainer]);

  const onChangeAzureTenantIdHandler = useCallback((val: string) => {
    adminAppContainer.changeAzureTenantId(val);
  }, [adminAppContainer]);

  const onChangeAzureClientIdHandler = useCallback((val: string) => {
    adminAppContainer.changeAzureClientId(val);
  }, [adminAppContainer]);

  const onChangeAzureClientSecretHandler = useCallback((val: string) => {
    adminAppContainer.changeAzureClientSecret(val);
  }, [adminAppContainer]);

  const onChangeAzureStorageAccountNameHandler = useCallback((val: string) => {
    adminAppContainer.changeAzureStorageAccountName(val);
  }, [adminAppContainer]);

  const onChangeAzureStorageContainerNameHandler = useCallback((val: string) => {
    adminAppContainer.changeAzureStorageContainerName(val);
  }, [adminAppContainer]);

  return (
    <form onSubmit={handleSubmit(submitHandler)}>
      <FileUploadSettingMolecule
        register={register}
        fileUploadType={fileUploadType}
        isFixedFileUploadByEnvVar={isFixedFileUploadByEnvVar}
        envFileUploadType={envFileUploadType}
        onChangeFileUploadType={onChangeFileUploadTypeHandler}
        s3ReferenceFileWithRelayMode={s3ReferenceFileWithRelayMode}
        s3Region={s3Region}
        s3CustomEndpoint={s3CustomEndpoint}
        s3Bucket={s3Bucket}
        s3AccessKeyId={s3AccessKeyId}
        s3SecretAccessKey={s3SecretAccessKey}
        onChangeS3ReferenceFileWithRelayMode={onChangeS3ReferenceFileWithRelayModeHandler}
        onChangeS3Region={onChangeS3RegionHandler}
        onChangeS3CustomEndpoint={onChangeS3CustomEndpointHandler}
        onChangeS3Bucket={onChangeS3BucketHandler}
        onChangeS3AccessKeyId={onChangeS3AccessKeyIdHandler}
        onChangeS3SecretAccessKey={onChangeS3SecretAccessKeyHandler}
        gcsReferenceFileWithRelayMode={gcsReferenceFileWithRelayMode}
        gcsUseOnlyEnvVars={gcsUseOnlyEnvVars}
        gcsApiKeyJsonPath={gcsApiKeyJsonPath}
        gcsBucket={gcsBucket}
        gcsUploadNamespace={gcsUploadNamespace}
        envGcsApiKeyJsonPath={envGcsApiKeyJsonPath}
        envGcsBucket={envGcsBucket}
        envGcsUploadNamespace={envGcsUploadNamespace}
        onChangeGcsReferenceFileWithRelayMode={onChangeGcsReferenceFileWithRelayModeHandler}
        onChangeGcsApiKeyJsonPath={onChangeGcsApiKeyJsonPathHandler}
        onChangeGcsBucket={onChangeGcsBucketHandler}
        onChangeGcsUploadNamespace={onChangeGcsUploadNamespaceHandler}
        azureReferenceFileWithRelayMode={azureReferenceFileWithRelayMode}
        azureUseOnlyEnvVars={azureUseOnlyEnvVars}
        azureTenantId={azureTenantId}
        azureClientId={azureClientId}
        azureClientSecret={azureClientSecret}
        azureStorageAccountName={azureStorageAccountName}
        azureStorageContainerName={azureStorageContainerName}
        envAzureTenantId={envAzureTenantId}
        envAzureClientId={envAzureClientId}
        envAzureClientSecret={envAzureClientSecret}
        envAzureStorageAccountName={envAzureStorageAccountName}
        envAzureStorageContainerName={envAzureStorageContainerName}
        onChangeAzureReferenceFileWithRelayMode={onChangeAzureReferenceFileWithRelayModeHandler}
        onChangeAzureTenantId={onChangeAzureTenantIdHandler}
        onChangeAzureClientId={onChangeAzureClientIdHandler}
        onChangeAzureClientSecret={onChangeAzureClientSecretHandler}
        onChangeAzureStorageAccountName={onChangeAzureStorageAccountNameHandler}
        onChangeAzureStorageContainerName={onChangeAzureStorageContainerNameHandler}
      />
      <AdminUpdateButtonRow disabled={retrieveError != null} />
    </form>
  );
};


/**
 * Wrapper component for using unstated
 */
const FileUploadSettingWrapper = withUnstatedContainers(FileUploadSetting, [AdminAppContainer]);

export default FileUploadSettingWrapper;
