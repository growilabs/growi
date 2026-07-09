import type { RawConfigData } from '@growi/core/dist/interfaces';
import { mock } from 'vitest-mock-extended';

import type { S2sMessagingService } from '../s2s-messaging/base';
import type { ConfigKey, ConfigValues } from './config-definition';
import { configManager } from './config-manager';

// Test helper type for setting configs
type TestConfigData = RawConfigData<ConfigKey, ConfigValues>;

const mocks = vi.hoisted(() => ({
  ConfigMock: {
    updateOne: vi.fn(),
    bulkWrite: vi.fn(),
    deleteOne: vi.fn(),
  },
}));
vi.mock('../../models/config', () => ({
  Config: mocks.ConfigMock,
}));

type ConfigManagerToGetLoader = {
  configLoader: { loadFromDB: () => void };
};

describe('ConfigManager test', () => {
  const s2sMessagingServiceMock = mock<S2sMessagingService>();

  beforeAll(async () => {
    process.env.CONFIG_PUBSUB_SERVER_TYPE = 'nchan';
    configManager.setS2sMessagingService(s2sMessagingServiceMock);
  });

  describe('updateConfig()', () => {
    let loadConfigsSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(async () => {
      loadConfigsSpy = vi.spyOn(configManager, 'loadConfigs');
      // Reset mocks
      mocks.ConfigMock.updateOne.mockClear();
      mocks.ConfigMock.deleteOne.mockClear();
    });

    test('invoke publishUpdateMessage()', async () => {
      // arrenge
      configManager.publishUpdateMessage = vi.fn();
      vi.spyOn(
        (configManager as unknown as ConfigManagerToGetLoader).configLoader,
        'loadFromDB',
      ).mockImplementation(vi.fn());

      // act
      await configManager.updateConfig('app:siteUrl', '');

      // assert
      expect(mocks.ConfigMock.updateOne).toHaveBeenCalledTimes(1);
      expect(loadConfigsSpy).toHaveBeenCalledTimes(1);
      expect(configManager.publishUpdateMessage).toHaveBeenCalledTimes(1);
    });

    test('skip publishUpdateMessage()', async () => {
      // arrenge
      configManager.publishUpdateMessage = vi.fn();
      vi.spyOn(
        (configManager as unknown as ConfigManagerToGetLoader).configLoader,
        'loadFromDB',
      ).mockImplementation(vi.fn());

      // act
      await configManager.updateConfig('app:siteUrl', '', { skipPubsub: true });

      // assert
      expect(mocks.ConfigMock.updateOne).toHaveBeenCalledTimes(1);
      expect(loadConfigsSpy).toHaveBeenCalledTimes(1);
      expect(configManager.publishUpdateMessage).not.toHaveBeenCalled();
    });

    test('remove config when value is undefined and removeIfUndefined is true', async () => {
      // arrange
      configManager.publishUpdateMessage = vi.fn();
      vi.spyOn(
        (configManager as unknown as ConfigManagerToGetLoader).configLoader,
        'loadFromDB',
      ).mockImplementation(vi.fn());

      // act
      await configManager.updateConfig('app:siteUrl', undefined, {
        removeIfUndefined: true,
      });

      // assert
      expect(mocks.ConfigMock.deleteOne).toHaveBeenCalledTimes(1);
      expect(mocks.ConfigMock.deleteOne).toHaveBeenCalledWith({
        key: 'app:siteUrl',
      });
      expect(mocks.ConfigMock.updateOne).not.toHaveBeenCalled();
      expect(loadConfigsSpy).toHaveBeenCalledTimes(1);
      expect(configManager.publishUpdateMessage).toHaveBeenCalledTimes(1);
    });

    test('update config with undefined value when removeIfUndefined is false', async () => {
      // arrange
      configManager.publishUpdateMessage = vi.fn();
      vi.spyOn(
        (configManager as unknown as ConfigManagerToGetLoader).configLoader,
        'loadFromDB',
      ).mockImplementation(vi.fn());

      // act
      await configManager.updateConfig('app:siteUrl', undefined);

      // assert
      expect(mocks.ConfigMock.updateOne).toHaveBeenCalledTimes(1);
      expect(mocks.ConfigMock.updateOne).toHaveBeenCalledWith(
        { key: 'app:siteUrl' },
        { value: JSON.stringify(undefined) },
        { upsert: true },
      );
      expect(mocks.ConfigMock.deleteOne).not.toHaveBeenCalled();
      expect(loadConfigsSpy).toHaveBeenCalledTimes(1);
      expect(configManager.publishUpdateMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateConfigs()', () => {
    let loadConfigsSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(async () => {
      loadConfigsSpy = vi.spyOn(configManager, 'loadConfigs');
      // Reset mocks
      mocks.ConfigMock.bulkWrite.mockClear();
    });

    test('invoke publishUpdateMessage()', async () => {
      // arrange
      configManager.publishUpdateMessage = vi.fn();
      vi.spyOn(
        (configManager as unknown as ConfigManagerToGetLoader).configLoader,
        'loadFromDB',
      ).mockImplementation(vi.fn());

      // act
      await configManager.updateConfigs({
        'app:siteUrl': 'https://example.com',
      });

      // assert
      expect(mocks.ConfigMock.bulkWrite).toHaveBeenCalledTimes(1);
      expect(loadConfigsSpy).toHaveBeenCalledTimes(1);
      expect(configManager.publishUpdateMessage).toHaveBeenCalledTimes(1);
    });

    test('skip publishUpdateMessage()', async () => {
      // arrange
      configManager.publishUpdateMessage = vi.fn();
      vi.spyOn(
        (configManager as unknown as ConfigManagerToGetLoader).configLoader,
        'loadFromDB',
      ).mockImplementation(vi.fn());

      // act
      await configManager.updateConfigs(
        { 'app:siteUrl': '' },
        { skipPubsub: true },
      );

      // assert
      expect(mocks.ConfigMock.bulkWrite).toHaveBeenCalledTimes(1);
      expect(loadConfigsSpy).toHaveBeenCalledTimes(1);
      expect(configManager.publishUpdateMessage).not.toHaveBeenCalled();
    });

    test('remove configs when values are undefined and removeIfUndefined is true', async () => {
      // arrange
      configManager.publishUpdateMessage = vi.fn();
      vi.spyOn(
        (configManager as unknown as ConfigManagerToGetLoader).configLoader,
        'loadFromDB',
      ).mockImplementation(vi.fn());

      // act
      await configManager.updateConfigs(
        { 'app:siteUrl': undefined, 'app:title': 'GROWI' },
        { removeIfUndefined: true },
      );

      // assert
      expect(mocks.ConfigMock.bulkWrite).toHaveBeenCalledTimes(1);
      const operations = mocks.ConfigMock.bulkWrite.mock.calls[0][0];
      expect(operations).toHaveLength(2);
      expect(operations[0]).toEqual({
        deleteOne: { filter: { key: 'app:siteUrl' } },
      });
      expect(operations[1]).toEqual({
        updateOne: {
          filter: { key: 'app:title' },
          update: { value: JSON.stringify('GROWI') },
          upsert: true,
        },
      });
      expect(loadConfigsSpy).toHaveBeenCalledTimes(1);
      expect(configManager.publishUpdateMessage).toHaveBeenCalledTimes(1);
    });

    test('update configs including undefined values when removeIfUndefined is false', async () => {
      // arrange
      configManager.publishUpdateMessage = vi.fn();
      vi.spyOn(
        (configManager as unknown as ConfigManagerToGetLoader).configLoader,
        'loadFromDB',
      ).mockImplementation(vi.fn());

      // act
      await configManager.updateConfigs({
        'app:siteUrl': undefined,
        'app:title': 'GROWI',
      });

      // assert
      expect(mocks.ConfigMock.bulkWrite).toHaveBeenCalledTimes(1);
      const operations = mocks.ConfigMock.bulkWrite.mock.calls[0][0];
      expect(operations).toHaveLength(2); // both operations should be included
      expect(operations[0]).toEqual({
        updateOne: {
          filter: { key: 'app:siteUrl' },
          update: { value: JSON.stringify(undefined) },
          upsert: true,
        },
      });
      expect(operations[1]).toEqual({
        updateOne: {
          filter: { key: 'app:title' },
          update: { value: JSON.stringify('GROWI') },
          upsert: true,
        },
      });
      expect(loadConfigsSpy).toHaveBeenCalledTimes(1);
      expect(configManager.publishUpdateMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('getManagedEnvVars()', () => {
    beforeAll(async () => {
      process.env.AUTO_INSTALL_ADMIN_USERNAME = 'admin';
      process.env.AUTO_INSTALL_ADMIN_PASSWORD = 'password';

      await configManager.loadConfigs({ source: 'env' });
    });

    test('include secret', () => {
      // act
      const result = configManager.getManagedEnvVars(true);

      // assert
      expect(result.AUTO_INSTALL_ADMIN_USERNAME).toEqual('admin');
      expect(result.AUTO_INSTALL_ADMIN_PASSWORD).toEqual('password');
    });

    test('exclude secret', () => {
      // act
      const result = configManager.getManagedEnvVars();

      // assert
      expect(result.AUTO_INSTALL_ADMIN_USERNAME).toEqual('admin');
      expect(result.AUTO_INSTALL_ADMIN_PASSWORD).toEqual('***');
    });
  });

  describe('getConfig()', () => {
    // Helper function to set configs with proper typing
    const setTestConfigs = (
      dbConfig: Partial<TestConfigData>,
      envConfig: Partial<TestConfigData>,
    ): void => {
      Object.defineProperties(configManager, {
        dbConfig: { value: dbConfig, configurable: true },
        envConfig: { value: envConfig, configurable: true },
      });
    };

    beforeEach(async () => {
      // Reset configs before each test using properly typed empty objects
      setTestConfigs({}, {});
    });

    test('should fallback to env value when dbConfig[key] exists but its value is undefined', async () => {
      // Prepare test data that simulates the issue with proper typing
      const dbConfig: Partial<TestConfigData> = {
        'app:title': { value: undefined },
      };
      const envConfig: Partial<TestConfigData> = {
        'app:title': { value: 'GROWI' },
      };
      setTestConfigs(dbConfig, envConfig);

      // Act
      const result = configManager.getConfig('app:title');

      // Assert - Should return env value since db value is undefined
      expect(result).toBe('GROWI');
    });

    test('should handle various edge case scenarios correctly', async () => {
      // Setup multiple test scenarios with proper typing
      const dbConfig: Partial<TestConfigData> = {
        'app:title': { value: undefined }, // db value is explicitly undefined
        'app:siteUrl': { value: undefined }, // another undefined value
        'app:fileUploadType': { value: 'gridfs' }, // db has valid value
      };
      const envConfig: Partial<TestConfigData> = {
        'app:title': { value: 'GROWI' },
        'app:siteUrl': { value: 'https://example.com' },
        'app:fileUploadType': { value: 'aws' },
        // Add control flags for env vars
        'env:useOnlyEnvVars:app:siteUrl': { value: false },
        'env:useOnlyEnvVars:app:fileUploadType': { value: false },
      };
      setTestConfigs(dbConfig, envConfig);

      // Test each scenario
      expect(configManager.getConfig('app:title')).toBe('GROWI'); // Should fallback to env when db value is undefined
      expect(configManager.getConfig('app:siteUrl')).toBe(
        'https://example.com',
      ); // Should fallback to env when db value is undefined
      expect(configManager.getConfig('app:fileUploadType')).toBe('gridfs'); // Should use db value when valid
    });

    describe('env-only mode for AI settings (env:useOnlyEnvVars:ai)', () => {
      // The 3 keys fixed by the env:useOnlyEnvVars:ai control key: the AI
      // enable toggle + the two provider connection keys (multi-provider
      // settings and per-provider API keys). ai:allowedModels is deliberately
      // NOT part of the group: model settings stay editable from the admin UI
      // even in env-only mode (R5.3).
      const aiEnvOnlyKeys = [
        'app:aiEnabled',
        'ai:providers',
        'ai:providerApiKeys',
      ] as const;

      // Distinct db/env values per key so a resolution that picks the wrong
      // source is observable. Booleans use opposite values across db/env; the
      // Record-typed keys differ by provider entry across db/env.
      const dbValues: Partial<TestConfigData> = {
        'app:aiEnabled': { value: true },
        'ai:providers': {
          value: {
            openai: { enabled: true },
            'azure-openai': {
              enabled: true,
              azureOpenaiSettings: { resourceName: 'db-resource' },
            },
          },
        },
        'ai:providerApiKeys': { value: { openai: 'db-api-key' } },
        'ai:allowedModels': {
          value: [
            {
              provider: 'openai',
              modelId: 'db-model',
              providerOptions: { openai: { db: true } },
              isDefault: true,
            },
          ],
        },
      };
      const envValues: Partial<TestConfigData> = {
        'app:aiEnabled': { value: false },
        'ai:providers': {
          value: { anthropic: { enabled: true } },
        },
        'ai:providerApiKeys': { value: { anthropic: 'env-api-key' } },
        'ai:allowedModels': {
          value: [
            {
              provider: 'anthropic',
              modelId: 'env-model',
              providerOptions: { anthropic: { env: true } },
              isDefault: true,
            },
          ],
        },
      };

      test('returns env value only (ignoring db) for the 3 connection keys when control key is true', () => {
        setTestConfigs(dbValues, {
          ...envValues,
          'env:useOnlyEnvVars:ai': { value: true },
        });

        for (const key of aiEnvOnlyKeys) {
          expect(configManager.getConfig(key)).toEqual(envValues[key]?.value);
        }
      });

      test('keeps db-first resolution for ai:allowedModels even when control key is true (R5.3)', () => {
        setTestConfigs(dbValues, {
          ...envValues,
          'env:useOnlyEnvVars:ai': { value: true },
        });

        expect(configManager.getConfig('ai:allowedModels')).toEqual(
          dbValues['ai:allowedModels']?.value,
        );
      });

      test('returns db value (env as fallback default) for all AI keys when control key is false', () => {
        setTestConfigs(dbValues, {
          ...envValues,
          'env:useOnlyEnvVars:ai': { value: false },
        });

        for (const key of [...aiEnvOnlyKeys, 'ai:allowedModels'] as const) {
          expect(configManager.getConfig(key)).toEqual(dbValues[key]?.value);
        }
      });

      test('falls back to env value when db value is undefined and control key is false', () => {
        setTestConfigs(
          { 'ai:providers': { value: undefined } },
          {
            'ai:providers': { value: { anthropic: { enabled: true } } },
            'env:useOnlyEnvVars:ai': { value: false },
          },
        );

        expect(configManager.getConfig('ai:providers')).toEqual({
          anthropic: { enabled: true },
        });
      });

      test('does not change resolution of unrelated keys when control key is true', () => {
        // app:title is not part of the ai env-only group, so it must keep the
        // default db ?? env resolution regardless of env:useOnlyEnvVars:ai.
        setTestConfigs(
          { 'app:title': { value: 'db-title' } },
          {
            'app:title': { value: 'env-title' },
            'env:useOnlyEnvVars:ai': { value: true },
          },
        );

        expect(configManager.getConfig('app:title')).toBe('db-title');
      });
    });
  });
});
