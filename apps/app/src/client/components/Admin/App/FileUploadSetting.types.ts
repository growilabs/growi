export type FileUploadType = 'aws' | 'gcs' | 'azure' | 'local' | 'mongodb' | 'none';

export type FileUploadFormValues = {
  fileUploadType: FileUploadType
  // AWS S3
  s3Region: string
  s3CustomEndpoint: string
  s3Bucket: string
  s3AccessKeyId: string
  s3SecretAccessKey: string
  s3ReferenceFileWithRelayMode: boolean
  // GCS
  gcsApiKeyJsonPath: string
  gcsBucket: string
  gcsUploadNamespace: string
  gcsReferenceFileWithRelayMode: boolean
  // Azure
  azureTenantId: string
  azureClientId: string
  azureClientSecret: string
  azureStorageAccountName: string
  azureStorageContainerName: string
  azureReferenceFileWithRelayMode: boolean
};

export type FileUploadSettingsData = FileUploadFormValues & {
  isFixedFileUploadByEnvVar: boolean
  envFileUploadType?: string
  // GCS env vars
  gcsUseOnlyEnvVars: boolean
  envGcsApiKeyJsonPath?: string
  envGcsBucket?: string
  envGcsUploadNamespace?: string
  // Azure env vars
  azureUseOnlyEnvVars: boolean
  envAzureTenantId?: string
  envAzureClientId?: string
  envAzureClientSecret?: string
  envAzureStorageAccountName?: string
  envAzureStorageContainerName?: string
};
