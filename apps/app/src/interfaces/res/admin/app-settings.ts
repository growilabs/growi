export type IResAppSettings = {
  title: string;
  confidential: string;
  globalLang: string;
  isEmailPublishedForNewUser: boolean;
  fileUpload: string;
  isV5Compatible: boolean;
  siteUrl: string;
  envSiteUrl: string;
  isMailerSetup: boolean;
  fromAddress: string;

  transmissionMethod: string;
  smtpHost: string;
  smtpPort: string | number; // TODO: check
  smtpUser: string;
  smtpPassword: string;
  sesAccessKeyId: string;
  sesSecretAccessKey: string;

  fileUploadType: string;
  envFileUploadType: string;
  useOnlyEnvVarForFileUploadType: boolean;

  s3Region: string;
  s3CustomEndpoint: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3ReferenceFileWithRelayMode: string;

  gcsUseOnlyEnvVars: boolean;
  gcsApiKeyJsonPath: string;
  gcsBucket: string;
  gcsUploadNamespace: string;
  gcsReferenceFileWithRelayMode: string;

  envGcsApiKeyJsonPath: string;
  envGcsBucket: string;
  envGcsUploadNamespace: string;

  azureUseOnlyEnvVars: boolean;
  azureTenantId: string;
  azureClientId: string;
  azureClientSecret: string;
  azureStorageAccountName: string;
  azureStorageContainerName: string;
  azureReferenceFileWithRelayMode: string;

  envAzureTenantId: string;
  envAzureClientId: string;
  envAzureClientSecret: string;
  envAzureStorageAccountName: string;
  envAzureStorageContainerName: string;

  isAppSiteUrlHashed: boolean;

  isMaintenanceMode: boolean;

  isBulkExportPagesEnabled: boolean;
  envIsBulkExportPagesEnabled: boolean;
  bulkExportDownloadExpirationSeconds: number;
  useOnlyEnvVarsForIsBulkExportPagesEnabled: boolean;
};
