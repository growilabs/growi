import { describe, it, expect } from 'vitest';

import type { FileUploadFormValues, FileUploadSettingsData } from './FileUploadSetting.types';

/**
 * Helper function to build settings data (mimics useFileUploadSettings fetchData logic)
 */
function buildSettingsData(appSettingsParams: Record<string, any>): FileUploadSettingsData {
  return {
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
}

/**
 * Helper function to build request params (mimics useFileUploadSettings updateSettings logic)
 */
function buildRequestParams(
    formData: FileUploadFormValues,
    dirtyFields: Partial<Record<keyof FileUploadFormValues, boolean>>,
): Record<string, any> {
  const { fileUploadType } = formData;

  const requestParams: Record<string, any> = {
    fileUploadType,
  };

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

  return requestParams;
}

describe('useFileUploadSettings - fileUploadType selection with useOnlyEnvVarForFileUploadType', () => {
  it('should use envFileUploadType when useOnlyEnvVarForFileUploadType is true', () => {
    const appSettingsParams = {
      fileUploadType: 'local',
      envFileUploadType: 'aws',
      useOnlyEnvVarForFileUploadType: true,
    };

    const settingsData = buildSettingsData(appSettingsParams);

    expect(settingsData.fileUploadType).toBe('aws');
    expect(settingsData.isFixedFileUploadByEnvVar).toBe(true);
    expect(settingsData.envFileUploadType).toBe('aws');
  });

  it('should use fileUploadType when useOnlyEnvVarForFileUploadType is false', () => {
    const appSettingsParams = {
      fileUploadType: 'gcs',
      envFileUploadType: 'aws',
      useOnlyEnvVarForFileUploadType: false,
    };

    const settingsData = buildSettingsData(appSettingsParams);

    expect(settingsData.fileUploadType).toBe('gcs');
    expect(settingsData.isFixedFileUploadByEnvVar).toBe(false);
    expect(settingsData.envFileUploadType).toBe('aws');
  });

  it('should use fileUploadType when useOnlyEnvVarForFileUploadType is undefined', () => {
    const appSettingsParams = {
      fileUploadType: 'azure',
      envFileUploadType: 'aws',
    };

    const settingsData = buildSettingsData(appSettingsParams);

    expect(settingsData.fileUploadType).toBe('azure');
    expect(settingsData.isFixedFileUploadByEnvVar).toBe(false);
  });

  it('should prioritize envFileUploadType over fileUploadType when env var is enforced', () => {
    const appSettingsParams = {
      fileUploadType: 'local',
      envFileUploadType: 'gcs',
      useOnlyEnvVarForFileUploadType: true,
    };

    const settingsData = buildSettingsData(appSettingsParams);

    // Even though DB has 'local', env var 'gcs' should be used
    expect(settingsData.fileUploadType).toBe('gcs');
    expect(settingsData.isFixedFileUploadByEnvVar).toBe(true);
  });
});

describe('useFileUploadSettings - secret field dirty tracking', () => {
  it('should NOT include s3SecretAccessKey in request when it is not dirty (AWS)', () => {
    const formData: FileUploadFormValues = {
      fileUploadType: 'aws',
      s3Region: 'us-west-2',
      s3CustomEndpoint: '',
      s3Bucket: 'new-bucket',
      s3AccessKeyId: 'new-key-id',
      s3SecretAccessKey: '***existing-secret***', // Not changed
      s3ReferenceFileWithRelayMode: true,
      gcsApiKeyJsonPath: '',
      gcsBucket: '',
      gcsUploadNamespace: '',
      gcsReferenceFileWithRelayMode: false,
      azureTenantId: '',
      azureClientId: '',
      azureClientSecret: '',
      azureStorageAccountName: '',
      azureStorageContainerName: '',
      azureReferenceFileWithRelayMode: false,
    };

    const dirtyFields = {
      s3Region: true,
      s3Bucket: true,
      s3AccessKeyId: true,
      s3ReferenceFileWithRelayMode: true,
      // s3SecretAccessKey is NOT marked as dirty
    };

    const requestParams = buildRequestParams(formData, dirtyFields);

    expect(requestParams).toEqual({
      fileUploadType: 'aws',
      s3Region: 'us-west-2',
      s3CustomEndpoint: '',
      s3Bucket: 'new-bucket',
      s3AccessKeyId: 'new-key-id',
      s3ReferenceFileWithRelayMode: true,
    });

    // Verify s3SecretAccessKey is NOT in the request
    expect(requestParams).not.toHaveProperty('s3SecretAccessKey');
  });

  it('should include s3SecretAccessKey in request when it is dirty (AWS)', () => {
    const formData: FileUploadFormValues = {
      fileUploadType: 'aws',
      s3Region: 'us-west-2',
      s3CustomEndpoint: '',
      s3Bucket: 'new-bucket',
      s3AccessKeyId: 'new-key-id',
      s3SecretAccessKey: 'new-secret-key', // Changed
      s3ReferenceFileWithRelayMode: true,
      gcsApiKeyJsonPath: '',
      gcsBucket: '',
      gcsUploadNamespace: '',
      gcsReferenceFileWithRelayMode: false,
      azureTenantId: '',
      azureClientId: '',
      azureClientSecret: '',
      azureStorageAccountName: '',
      azureStorageContainerName: '',
      azureReferenceFileWithRelayMode: false,
    };

    const dirtyFields = {
      s3Region: true,
      s3Bucket: true,
      s3AccessKeyId: true,
      s3SecretAccessKey: true, // Marked as dirty
      s3ReferenceFileWithRelayMode: true,
    };

    const requestParams = buildRequestParams(formData, dirtyFields);

    expect(requestParams).toEqual({
      fileUploadType: 'aws',
      s3Region: 'us-west-2',
      s3CustomEndpoint: '',
      s3Bucket: 'new-bucket',
      s3AccessKeyId: 'new-key-id',
      s3SecretAccessKey: 'new-secret-key',
      s3ReferenceFileWithRelayMode: true,
    });
  });

  it('should include empty string for s3SecretAccessKey when explicitly set to empty (AWS)', () => {
    const formData: FileUploadFormValues = {
      fileUploadType: 'aws',
      s3Region: 'us-west-2',
      s3CustomEndpoint: '',
      s3Bucket: 'new-bucket',
      s3AccessKeyId: 'new-key-id',
      s3SecretAccessKey: '', // Explicitly cleared
      s3ReferenceFileWithRelayMode: true,
      gcsApiKeyJsonPath: '',
      gcsBucket: '',
      gcsUploadNamespace: '',
      gcsReferenceFileWithRelayMode: false,
      azureTenantId: '',
      azureClientId: '',
      azureClientSecret: '',
      azureStorageAccountName: '',
      azureStorageContainerName: '',
      azureReferenceFileWithRelayMode: false,
    };

    const dirtyFields = {
      s3Region: true,
      s3Bucket: true,
      s3AccessKeyId: true,
      s3SecretAccessKey: true, // Marked as dirty
      s3ReferenceFileWithRelayMode: true,
    };

    const requestParams = buildRequestParams(formData, dirtyFields);

    expect(requestParams).toHaveProperty('s3SecretAccessKey', '');
  });

  it('should NOT include Azure secret fields in request when they are not dirty', () => {
    const formData: FileUploadFormValues = {
      fileUploadType: 'azure',
      s3Region: '',
      s3CustomEndpoint: '',
      s3Bucket: '',
      s3AccessKeyId: '',
      s3SecretAccessKey: '',
      s3ReferenceFileWithRelayMode: false,
      gcsApiKeyJsonPath: '',
      gcsBucket: '',
      gcsUploadNamespace: '',
      gcsReferenceFileWithRelayMode: false,
      azureTenantId: '***existing-tenant***', // Not changed
      azureClientId: '***existing-client***', // Not changed
      azureClientSecret: '***existing-secret***', // Not changed
      azureStorageAccountName: 'new-account',
      azureStorageContainerName: 'new-container',
      azureReferenceFileWithRelayMode: true,
    };

    const dirtyFields = {
      azureStorageAccountName: true,
      azureStorageContainerName: true,
      azureReferenceFileWithRelayMode: true,
      // Azure secret fields are NOT marked as dirty
    };

    const requestParams = buildRequestParams(formData, dirtyFields);

    expect(requestParams).not.toHaveProperty('azureTenantId');
    expect(requestParams).not.toHaveProperty('azureClientId');
    expect(requestParams).not.toHaveProperty('azureClientSecret');
    expect(requestParams).toHaveProperty('azureStorageAccountName', 'new-account');
    expect(requestParams).toHaveProperty('azureStorageContainerName', 'new-container');
  });

  it('should include Azure secret fields in request when they are dirty', () => {
    const formData: FileUploadFormValues = {
      fileUploadType: 'azure',
      s3Region: '',
      s3CustomEndpoint: '',
      s3Bucket: '',
      s3AccessKeyId: '',
      s3SecretAccessKey: '',
      s3ReferenceFileWithRelayMode: false,
      gcsApiKeyJsonPath: '',
      gcsBucket: '',
      gcsUploadNamespace: '',
      gcsReferenceFileWithRelayMode: false,
      azureTenantId: 'new-tenant-id',
      azureClientId: 'new-client-id',
      azureClientSecret: 'new-client-secret',
      azureStorageAccountName: 'new-account',
      azureStorageContainerName: 'new-container',
      azureReferenceFileWithRelayMode: true,
    };

    const dirtyFields = {
      azureTenantId: true,
      azureClientId: true,
      azureClientSecret: true,
      azureStorageAccountName: true,
      azureStorageContainerName: true,
      azureReferenceFileWithRelayMode: true,
    };

    const requestParams = buildRequestParams(formData, dirtyFields);

    expect(requestParams).toEqual({
      fileUploadType: 'azure',
      azureTenantId: 'new-tenant-id',
      azureClientId: 'new-client-id',
      azureClientSecret: 'new-client-secret',
      azureStorageAccountName: 'new-account',
      azureStorageContainerName: 'new-container',
      azureReferenceFileWithRelayMode: true,
    });
  });

  it('should include only some Azure secret fields when only some are dirty', () => {
    const formData: FileUploadFormValues = {
      fileUploadType: 'azure',
      s3Region: '',
      s3CustomEndpoint: '',
      s3Bucket: '',
      s3AccessKeyId: '',
      s3SecretAccessKey: '',
      s3ReferenceFileWithRelayMode: false,
      gcsApiKeyJsonPath: '',
      gcsBucket: '',
      gcsUploadNamespace: '',
      gcsReferenceFileWithRelayMode: false,
      azureTenantId: 'new-tenant-id',
      azureClientId: '***existing-client***', // Not changed
      azureClientSecret: 'new-client-secret',
      azureStorageAccountName: 'new-account',
      azureStorageContainerName: 'new-container',
      azureReferenceFileWithRelayMode: true,
    };

    const dirtyFields = {
      azureTenantId: true, // Marked as dirty
      // azureClientId is NOT marked as dirty
      azureClientSecret: true, // Marked as dirty
      azureStorageAccountName: true,
      azureStorageContainerName: true,
      azureReferenceFileWithRelayMode: true,
    };

    const requestParams = buildRequestParams(formData, dirtyFields);

    expect(requestParams).toHaveProperty('azureTenantId', 'new-tenant-id');
    expect(requestParams).not.toHaveProperty('azureClientId');
    expect(requestParams).toHaveProperty('azureClientSecret', 'new-client-secret');
  });
});
