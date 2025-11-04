import { useState, useEffect } from 'react';

import type { FieldNamesMarkedBoolean } from 'react-hook-form';

import { apiv3Get, apiv3Put } from '~/client/util/apiv3-client';

import type { FileUploadSettingsData, FileUploadFormValues } from './FileUploadSetting.types';

type UseFileUploadSettingsReturn = {
  data: FileUploadSettingsData | null
  isLoading: boolean
  error: Error | null
  updateSettings: (formData: FileUploadFormValues, dirtyFields: FieldNamesMarkedBoolean<FileUploadFormValues>) => Promise<void>
};

export function useFileUploadSettings(): UseFileUploadSettingsReturn {
  const [data, setData] = useState<FileUploadSettingsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchData = async() => {
      try {
        setIsLoading(true);
        const response = await apiv3Get('/app-settings/');
        const { appSettingsParams } = response.data;

        const settingsData: FileUploadSettingsData = {
          // File upload type
          fileUploadType: appSettingsParams.useOnlyEnvVarForFileUploadType
            ? appSettingsParams.envFileUploadType
            : appSettingsParams.fileUploadType,
          isFixedFileUploadByEnvVar: appSettingsParams.useOnlyEnvVarForFileUploadType || false,
          envFileUploadType: appSettingsParams.envFileUploadType,

          // AWS S3
          s3Region: appSettingsParams.s3Region || '',
          s3CustomEndpoint: appSettingsParams.s3CustomEndpoint || '',
          s3Bucket: appSettingsParams.s3Bucket || '',
          s3AccessKeyId: appSettingsParams.s3AccessKeyId || '',
          s3SecretAccessKey: appSettingsParams.s3SecretAccessKey || '',
          s3ReferenceFileWithRelayMode: appSettingsParams.s3ReferenceFileWithRelayMode || false,

          // GCS
          gcsApiKeyJsonPath: appSettingsParams.gcsApiKeyJsonPath || '',
          gcsBucket: appSettingsParams.gcsBucket || '',
          gcsUploadNamespace: appSettingsParams.gcsUploadNamespace || '',
          gcsReferenceFileWithRelayMode: appSettingsParams.gcsReferenceFileWithRelayMode || false,
          gcsUseOnlyEnvVars: appSettingsParams.gcsUseOnlyEnvVars || false,
          envGcsApiKeyJsonPath: appSettingsParams.envGcsApiKeyJsonPath,
          envGcsBucket: appSettingsParams.envGcsBucket,
          envGcsUploadNamespace: appSettingsParams.envGcsUploadNamespace,

          // Azure
          azureTenantId: appSettingsParams.azureTenantId || '',
          azureClientId: appSettingsParams.azureClientId || '',
          azureClientSecret: appSettingsParams.azureClientSecret || '',
          azureStorageAccountName: appSettingsParams.azureStorageAccountName || '',
          azureStorageContainerName: appSettingsParams.azureStorageContainerName || '',
          azureReferenceFileWithRelayMode: appSettingsParams.azureReferenceFileWithRelayMode || false,
          azureUseOnlyEnvVars: appSettingsParams.azureUseOnlyEnvVars || false,
          envAzureTenantId: appSettingsParams.envAzureTenantId,
          envAzureClientId: appSettingsParams.envAzureClientId,
          envAzureClientSecret: appSettingsParams.envAzureClientSecret,
          envAzureStorageAccountName: appSettingsParams.envAzureStorageAccountName,
          envAzureStorageContainerName: appSettingsParams.envAzureStorageContainerName,
        };

        setData(settingsData);
        setError(null);
      }
      catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch settings'));
      }
      finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const updateSettings = async(formData: FileUploadFormValues, dirtyFields: FieldNamesMarkedBoolean<FileUploadFormValues>): Promise<void> => {
    const { fileUploadType } = formData;

    const requestParams: Record<string, any> = {
      fileUploadType,
    };

    // Add fields based on upload type
    if (fileUploadType === 'aws') {
      requestParams.s3Region = formData.s3Region;
      requestParams.s3CustomEndpoint = formData.s3CustomEndpoint;
      requestParams.s3Bucket = formData.s3Bucket;
      requestParams.s3AccessKeyId = formData.s3AccessKeyId;
      // Only include secret access key if it was changed
      if (dirtyFields.s3SecretAccessKey) {
        requestParams.s3SecretAccessKey = formData.s3SecretAccessKey;
      }
      requestParams.s3ReferenceFileWithRelayMode = formData.s3ReferenceFileWithRelayMode;
    }

    if (fileUploadType === 'gcs') {
      requestParams.gcsApiKeyJsonPath = formData.gcsApiKeyJsonPath;
      requestParams.gcsBucket = formData.gcsBucket;
      requestParams.gcsUploadNamespace = formData.gcsUploadNamespace;
      requestParams.gcsReferenceFileWithRelayMode = formData.gcsReferenceFileWithRelayMode;
    }

    if (fileUploadType === 'azure') {
      // Only include secret fields if they were changed
      if (dirtyFields.azureTenantId) {
        requestParams.azureTenantId = formData.azureTenantId;
      }
      if (dirtyFields.azureClientId) {
        requestParams.azureClientId = formData.azureClientId;
      }
      if (dirtyFields.azureClientSecret) {
        requestParams.azureClientSecret = formData.azureClientSecret;
      }
      requestParams.azureStorageAccountName = formData.azureStorageAccountName;
      requestParams.azureStorageContainerName = formData.azureStorageContainerName;
      requestParams.azureReferenceFileWithRelayMode = formData.azureReferenceFileWithRelayMode;
    }

    const response = await apiv3Put('/app-settings/file-upload-setting', requestParams);
    const { responseParams } = response.data;

    // Update local state with response
    if (data) {
      setData({
        ...data,
        ...responseParams,
      });
    }
  };

  return {
    data, isLoading, error, updateSettings,
  };
}
