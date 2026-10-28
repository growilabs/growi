import { ConfigSource } from '@growi/core/dist/interfaces';

import type { ConfigKey } from './config-definition';
import { ConfigLoader } from './config-loader';
import { ConfigManager } from './config-manager';

const storageCases: {
  key: ConfigKey;
  env: string;
  flag: string;
  envValue: string;
  expected: string | boolean | number;
  dbValue: string | boolean | number;
}[] = [
  {
    key: 'aws:s3Bucket',
    env: 'S3_BUCKET',
    flag: 'AWS',
    envValue: 'hosted-bucket',
    expected: 'hosted-bucket',
    dbValue: 'owned-bucket',
  },
  {
    key: 'aws:s3Region',
    env: 'S3_REGION',
    flag: 'AWS',
    envValue: 'us-east-1',
    expected: 'us-east-1',
    dbValue: 'ap-northeast-1',
  },
  {
    key: 'aws:s3AccessKeyId',
    env: 'S3_ACCESS_KEY_ID',
    flag: 'AWS',
    envValue: 'hosted-access',
    expected: 'hosted-access',
    dbValue: 'owned-access',
  },
  {
    key: 'aws:s3SecretAccessKey',
    env: 'S3_SECRET_ACCESS_KEY',
    flag: 'AWS',
    envValue: 'hosted-secret',
    expected: 'hosted-secret',
    dbValue: 'owned-secret',
  },
  {
    key: 'aws:s3CustomEndpoint',
    env: 'S3_CUSTOM_ENDPOINT',
    flag: 'AWS',
    envValue: 'https://hosted.example',
    expected: 'https://hosted.example',
    dbValue: 'https://owned.example',
  },
  {
    key: 'aws:referenceFileWithRelayMode',
    env: 'S3_REFERENCE_FILE_WITH_RELAY_MODE',
    flag: 'AWS',
    envValue: 'true',
    expected: true,
    dbValue: false,
  },
  {
    key: 'aws:lifetimeSecForTemporaryUrl',
    env: 'S3_LIFETIME_SEC_FOR_TEMPORARY_URL',
    flag: 'AWS',
    envValue: '300',
    expected: 300,
    dbValue: 120,
  },
  {
    key: 'aws:s3ObjectCannedACL',
    env: 'S3_OBJECT_ACL',
    flag: 'AWS',
    envValue: 'private',
    expected: 'private',
    dbValue: 'public-read',
  },
  {
    key: 'gcs:bucket',
    env: 'GCS_BUCKET',
    flag: 'GCS',
    envValue: 'hosted-bucket',
    expected: 'hosted-bucket',
    dbValue: 'owned-bucket',
  },
  {
    key: 'gcs:apiKeyJsonPath',
    env: 'GCS_API_KEY_JSON_PATH',
    flag: 'GCS',
    envValue: '/hosted/key.json',
    expected: '/hosted/key.json',
    dbValue: '/owned/key.json',
  },
  {
    key: 'gcs:uploadNamespace',
    env: 'GCS_UPLOAD_NAMESPACE',
    flag: 'GCS',
    envValue: 'hosted',
    expected: 'hosted',
    dbValue: 'owned',
  },
  {
    key: 'gcs:referenceFileWithRelayMode',
    env: 'GCS_REFERENCE_FILE_WITH_RELAY_MODE',
    flag: 'GCS',
    envValue: 'true',
    expected: true,
    dbValue: false,
  },
  {
    key: 'gcs:lifetimeSecForTemporaryUrl',
    env: 'GCS_LIFETIME_SEC_FOR_TEMPORARY_URL',
    flag: 'GCS',
    envValue: '300',
    expected: 300,
    dbValue: 120,
  },
  {
    key: 'azure:tenantId',
    env: 'AZURE_TENANT_ID',
    flag: 'AZURE',
    envValue: 'hosted-tenant',
    expected: 'hosted-tenant',
    dbValue: 'owned-tenant',
  },
  {
    key: 'azure:clientId',
    env: 'AZURE_CLIENT_ID',
    flag: 'AZURE',
    envValue: 'hosted-client',
    expected: 'hosted-client',
    dbValue: 'owned-client',
  },
  {
    key: 'azure:clientSecret',
    env: 'AZURE_CLIENT_SECRET',
    flag: 'AZURE',
    envValue: 'hosted-secret',
    expected: 'hosted-secret',
    dbValue: 'owned-secret',
  },
  {
    key: 'azure:storageAccountName',
    env: 'AZURE_STORAGE_ACCOUNT_NAME',
    flag: 'AZURE',
    envValue: 'hosted-account',
    expected: 'hosted-account',
    dbValue: 'owned-account',
  },
  {
    key: 'azure:storageContainerName',
    env: 'AZURE_STORAGE_CONTAINER_NAME',
    flag: 'AZURE',
    envValue: 'hosted-container',
    expected: 'hosted-container',
    dbValue: 'owned-container',
  },
  {
    key: 'azure:referenceFileWithRelayMode',
    env: 'AZURE_REFERENCE_FILE_WITH_RELAY_MODE',
    flag: 'AZURE',
    envValue: 'true',
    expected: true,
    dbValue: false,
  },
  {
    key: 'azure:lifetimeSecForTemporaryUrl',
    env: 'AZURE_LIFETIME_SEC_FOR_TEMPORARY_URL',
    flag: 'AZURE',
    envValue: '300',
    expected: 300,
    dbValue: 120,
  },
];

describe('storage configuration sources', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(storageCases)('resolves $key from env only when hosted', async ({
    key,
    env,
    flag,
    envValue,
    expected,
    dbValue,
  }) => {
    vi.stubEnv(env, envValue);
    vi.stubEnv(`${flag}_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS`, 'true');
    const envConfig = await new ConfigLoader().loadFromEnv();
    vi.spyOn(ConfigLoader.prototype, 'loadFromDB').mockResolvedValue({
      ...envConfig,
      [key]: { ...envConfig[key], value: dbValue },
    });
    const manager = new ConfigManager();
    await manager.loadConfigs();
    expect(manager.getConfig(key)).toBe(expected);
    expect(manager.getConfig(key, ConfigSource.db)).toBe(dbValue);

    vi.stubEnv(`${flag}_USES_ONLY_ENV_VARS_FOR_SOME_OPTIONS`, 'false');
    await manager.loadConfigs({ source: ConfigSource.env });
    expect(manager.getConfig(key)).toBe(dbValue);
  });
});
