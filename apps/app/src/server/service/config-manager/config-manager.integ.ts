import { GrowiDeploymentType, GrowiServiceType } from '@growi/core/dist/consts';
import { mock } from 'vitest-mock-extended';

import { Config } from '../../models/config';
import type { S2sMessagingService } from '../s2s-messaging/base';
import { configManager } from './config-manager';

describe('ConfigManager', () => {
  const s2sMessagingServiceMock = mock<S2sMessagingService>();

  beforeAll(async () => {
    configManager.setS2sMessagingService(s2sMessagingServiceMock);
  });

  describe("getConfig('app:siteUrl')", () => {
    beforeEach(async () => {
      process.env.APP_SITE_URL = 'http://localhost:3000';

      // remove config from DB
      await Config.deleteOne({ key: 'app:siteUrl' }).exec();
    });

    test('returns the env value"', async () => {
      // arrange
      await configManager.loadConfigs();

      // act
      const value = configManager.getConfig('app:siteUrl');

      // assert
      expect(value).toEqual('http://localhost:3000');
    });

    test('returns the db value"', async () => {
      // arrange
      await Config.create({
        key: 'app:siteUrl',
        value: JSON.stringify('https://example.com'),
      });
      await configManager.loadConfigs();

      // act
      const value = configManager.getConfig('app:siteUrl');

      // assert
      expect(value).toStrictEqual('https://example.com');
    });

    test('returns the env value when USES_ONLY_ENV_OPTION is set', async () => {
      // arrange
      process.env.APP_SITE_URL_USES_ONLY_ENV_VARS = 'true';
      await Config.create({
        key: 'app:siteUrl',
        value: JSON.stringify('https://example.com'),
      });
      await configManager.loadConfigs();

      // act
      const value = configManager.getConfig('app:siteUrl');

      // assert
      expect(value).toEqual('http://localhost:3000');
    });
  });

  describe("getConfig('security:passport-saml:isEnabled')", () => {
    beforeEach(async () => {
      // remove config from DB
      await Config.deleteOne({
        key: 'security:passport-saml:isEnabled',
      }).exec();
    });

    test('returns the default value"', async () => {
      // arrange
      await configManager.loadConfigs();

      // act
      const value = configManager.getConfig('security:passport-saml:isEnabled');

      // assert
      expect(value).toStrictEqual(false);
    });

    test('returns the env value"', async () => {
      // arrange
      process.env.SAML_ENABLED = 'true';
      await configManager.loadConfigs();

      // act
      const value = configManager.getConfig('security:passport-saml:isEnabled');

      // assert
      expect(value).toStrictEqual(true);
    });

    test('returns the preferred db value"', async () => {
      // arrange
      process.env.SAML_ENABLED = 'true';
      await Config.create({
        key: 'security:passport-saml:isEnabled',
        value: false,
      });
      await configManager.loadConfigs();

      // act
      const value = configManager.getConfig('security:passport-saml:isEnabled');

      // assert
      expect(value).toStrictEqual(false);
    });
  });

  describe('updateConfig', () => {
    beforeEach(async () => {
      await Config.deleteMany({ key: /app.*/ }).exec();
      await Config.create({
        key: 'app:siteUrl',
        value: JSON.stringify('initial value'),
      });
    });

    test('updates a single config', async () => {
      // arrange
      await configManager.loadConfigs();
      const config = await Config.findOne({ key: 'app:siteUrl' }).exec();
      expect(config?.value).toEqual(JSON.stringify('initial value'));

      // act
      await configManager.updateConfig('app:siteUrl', 'updated value');

      // assert
      const updatedConfig = await Config.findOne({ key: 'app:siteUrl' }).exec();
      expect(updatedConfig?.value).toEqual(JSON.stringify('updated value'));
    });

    test('removes config when value is undefined and removeIfUndefined is true', async () => {
      // arrange
      await configManager.loadConfigs();
      const config = await Config.findOne({ key: 'app:siteUrl' }).exec();
      expect(config?.value).toEqual(JSON.stringify('initial value'));

      // act
      await configManager.updateConfig('app:siteUrl', undefined, {
        removeIfUndefined: true,
      });

      // assert
      const updatedConfig = await Config.findOne({ key: 'app:siteUrl' }).exec();
      expect(updatedConfig).toBeNull(); // should be removed
    });

    test('does not update config when value is undefined and removeIfUndefined is false', async () => {
      // arrange
      await configManager.loadConfigs();
      const config = await Config.findOne({ key: 'app:siteUrl' }).exec();
      expect(config?.value).toEqual(JSON.stringify('initial value'));

      // act
      await configManager.updateConfig('app:siteUrl', undefined);

      // assert
      const updatedConfig = await Config.findOne({ key: 'app:siteUrl' }).exec();
      expect(updatedConfig?.value).toEqual(JSON.stringify('initial value')); // should remain unchanged
    });
  });

  describe('updateConfigs', () => {
    beforeEach(async () => {
      await Config.deleteMany({ key: /app.*/ }).exec();
      await Config.create({
        key: 'app:siteUrl',
        value: JSON.stringify('value1'),
      });
    });

    test('updates configs in the same namespace', async () => {
      // arrange
      await configManager.loadConfigs();
      const config1 = await Config.findOne({ key: 'app:siteUrl' }).exec();
      const config2 = await Config.findOne({
        key: 'app:fileUploadType',
      }).exec();
      expect(config1?.value).toEqual(JSON.stringify('value1'));
      expect(config2).toBeNull();

      // act
      await configManager.updateConfigs({
        'app:siteUrl': 'new value1',
        'app:fileUploadType': 'aws',
      });
      const updatedConfig1 = await Config.findOne({
        key: 'app:siteUrl',
      }).exec();
      const updatedConfig2 = await Config.findOne({
        key: 'app:fileUploadType',
      }).exec();

      // assert
      expect(updatedConfig1?.value).toEqual(JSON.stringify('new value1'));
      expect(updatedConfig2?.value).toEqual(JSON.stringify('aws'));
    });

    test('removes config when value is undefined and removeIfUndefined is true', async () => {
      // arrange
      await configManager.loadConfigs();
      const config1 = await Config.findOne({ key: 'app:siteUrl' }).exec();
      expect(config1?.value).toEqual(JSON.stringify('value1'));

      // act
      await configManager.updateConfigs(
        {
          'app:siteUrl': undefined,
          'app:fileUploadType': 'aws',
        },
        { removeIfUndefined: true },
      );

      // assert
      const updatedConfig1 = await Config.findOne({
        key: 'app:siteUrl',
      }).exec();
      const updatedConfig2 = await Config.findOne({
        key: 'app:fileUploadType',
      }).exec();
      expect(updatedConfig1).toBeNull(); // should be removed
      expect(updatedConfig2?.value).toEqual(JSON.stringify('aws'));
    });

    test('does not update config when value is undefined and removeIfUndefined is false', async () => {
      // arrange
      await configManager.loadConfigs();
      const config1 = await Config.findOne({ key: 'app:siteUrl' }).exec();
      expect(config1?.value).toEqual(JSON.stringify('value1'));

      // act
      await configManager.updateConfigs({
        'app:siteUrl': undefined,
        'app:fileUploadType': 'aws',
      });

      // assert
      const updatedConfig1 = await Config.findOne({
        key: 'app:siteUrl',
      }).exec();
      const updatedConfig2 = await Config.findOne({
        key: 'app:fileUploadType',
      }).exec();
      expect(updatedConfig1?.value).toEqual(JSON.stringify('value1')); // should remain unchanged
      expect(updatedConfig2?.value).toEqual(JSON.stringify('aws'));
    });
  });

  describe('removeConfigs', () => {
    beforeEach(async () => {
      await Config.deleteMany({ key: /app.*/ }).exec();
      await Config.create({
        key: 'app:serviceType',
        value: JSON.stringify(GrowiServiceType.onPremise),
      });
      await Config.create({
        key: 'app:deploymentType',
        value: JSON.stringify(GrowiDeploymentType.growiDockerCompose),
      });
    });

    test('removes configs in the same namespace', async () => {
      // arrange
      await configManager.loadConfigs();
      const config3 = await Config.findOne({ key: 'app:serviceType' }).exec();
      const config4 = await Config.findOne({
        key: 'app:deploymentType',
      }).exec();
      expect(config3?.value).toEqual(
        JSON.stringify(GrowiServiceType.onPremise),
      );
      expect(config4?.value).toEqual(
        JSON.stringify(GrowiDeploymentType.growiDockerCompose),
      );

      // act
      await configManager.removeConfigs([
        'app:serviceType',
        'app:deploymentType',
      ]);
      const removedConfig3 = await Config.findOne({
        key: 'app:serviceType',
      }).exec();
      const removedConfig4 = await Config.findOne({
        key: 'app:deploymentType',
      }).exec();

      // assert
      expect(removedConfig3).toBeNull();
      expect(removedConfig4).toBeNull();
    });
  });
});
