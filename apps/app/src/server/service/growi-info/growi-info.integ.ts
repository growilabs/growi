import type { IPage } from '^/../../packages/core/dist';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import pkg from '^/package.json';

import type UserEvent from '~/server/events/user';
import { Config } from '~/server/models/config';
import { configManager } from '~/server/service/config-manager';

import type Crowi from '../../crowi';
import type { PageModel } from '../../models/page';
import pageModel from '../../models/page';

import { growiInfoService } from './growi-info';

describe('GrowiInfoService', () => {
  const appVersion = pkg.version;

  let User;
  let Page;

  beforeAll(async() => {
    process.env.APP_SITE_URL = 'http://growi.test.jp';
    process.env.DEPLOYMENT_TYPE = 'growi-docker-compose';
    process.env.SAML_ENABLED = 'true';

    // setup page model before loading configs
    pageModel(null);
    Page = mongoose.model<IPage, PageModel>('Page');

    await configManager.loadConfigs();
    await configManager.updateConfigs({
      'security:passport-saml:isEnabled': true,
      'security:passport-github:isEnabled': true,
    });

    await Config.create({
      key: 'app:installed',
      value: true,
      createdAt: '2000-01-01',
    });

    const crowiMock = mock<Crowi>({
      version: appVersion,
      event: vi.fn().mockImplementation((eventName) => {
        if (eventName === 'user') {
          return mock<UserEvent>({
            on: vi.fn(),
          });
        }
      }),
    });

    const userModelFactory = (await import('~/server/models/user')).default;
    User = userModelFactory(crowiMock);

    await User.deleteMany({}); // clear users
    await Page.deleteMany({}); // clear pages

    await Page.create({
      path: '/',
      descendantCount: 0,
    });
  });

  describe('getGrowiInfo', () => {

    test('Should get correct GROWI info', async() => {
      const growiInfo = await growiInfoService.getGrowiInfo();

      assert(growiInfo != null);

      expect(growiInfo.osInfo?.type).toBeTruthy();
      expect(growiInfo.osInfo?.platform).toBeTruthy();
      expect(growiInfo.osInfo?.arch).toBeTruthy();
      expect(growiInfo.osInfo?.totalmem).toBeTruthy();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (growiInfo as any).osInfo;

      expect(growiInfo).toEqual({
        version: appVersion,
        appSiteUrl: 'http://growi.test.jp',
        serviceInstanceId: '',
        type: 'on-premise',
        wikiType: 'closed',
        deploymentType: 'growi-docker-compose',
      });
    });

    test('Should get correct GROWI info with additionalInfo', async() => {
      // arrange
      await User.create({
        username: 'growiinfo test user',
        createdAt: '2000-01-01',
      });

      // act
      const growiInfo = await growiInfoService.getGrowiInfo(true);

      // assert
      assert(growiInfo != null);

      expect(growiInfo.osInfo?.type).toBeTruthy();
      expect(growiInfo.osInfo?.platform).toBeTruthy();
      expect(growiInfo.osInfo?.arch).toBeTruthy();
      expect(growiInfo.osInfo?.totalmem).toBeTruthy();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (growiInfo as any).osInfo;

      expect(growiInfo).toEqual({
        version: appVersion,
        appSiteUrl: 'http://growi.test.jp',
        serviceInstanceId: '',
        type: 'on-premise',
        wikiType: 'closed',
        deploymentType: 'growi-docker-compose',
        additionalInfo: {
          installedAt: new Date('2000-01-01'),
          installedAtByOldestUser: new Date('2000-01-01'),
          currentUsersCount: 1,
          currentActiveUsersCount: 1,
          attachmentType: 'aws',
          activeExternalAccountTypes: ['saml', 'github'],
          currentPagesCount: 1,
        },
      });
    });

    test('Should get correct GROWI info with specific options - attachment only', async() => {
      // act
      const growiInfo = await growiInfoService.getGrowiInfo({ includeAttachmentInfo: true });

      // assert
      assert(growiInfo != null);
      expect(growiInfo.additionalInfo).toEqual({
        attachmentType: 'aws',
        activeExternalAccountTypes: ['saml', 'github'],
      });
    });

    test('Should get correct GROWI info with specific options - user count only', async() => {
      // act
      const growiInfo = await growiInfoService.getGrowiInfo({ includeUserCountInfo: true });

      // assert
      assert(growiInfo != null);
      expect(growiInfo.additionalInfo).toEqual({
        attachmentType: 'aws',
        activeExternalAccountTypes: ['saml', 'github'],
        currentUsersCount: 1, // Only one user from the legacy test
        currentActiveUsersCount: 1,
      });
    });

    test('Should get correct GROWI info with specific options - installed info only', async() => {
      // act
      const growiInfo = await growiInfoService.getGrowiInfo({ includeInstalledInfo: true });

      // assert
      assert(growiInfo != null);
      expect(growiInfo.additionalInfo).toEqual({
        attachmentType: 'aws',
        activeExternalAccountTypes: ['saml', 'github'],
        installedAt: new Date('2000-01-01'),
        installedAtByOldestUser: new Date('2000-01-01'),
      });
    });

    test('Should get correct GROWI info with combined options', async() => {
      // act
      const growiInfo = await growiInfoService.getGrowiInfo({
        includeAttachmentInfo: true,
        includeUserCountInfo: true,
        includePageCountInfo: true,
      });

      // assert
      assert(growiInfo != null);
      expect(growiInfo.additionalInfo).toEqual({
        attachmentType: 'aws',
        activeExternalAccountTypes: ['saml', 'github'],
        currentUsersCount: 1,
        currentActiveUsersCount: 1,
        currentPagesCount: 1,
      });
    });

    test('Should get correct GROWI info with all options', async() => {
      // act
      const growiInfo = await growiInfoService.getGrowiInfo({
        includeAttachmentInfo: true,
        includeInstalledInfo: true,
        includeUserCountInfo: true,
        includePageCountInfo: true,
      });

      // assert
      assert(growiInfo != null);
      expect(growiInfo.additionalInfo).toEqual({
        attachmentType: 'aws',
        activeExternalAccountTypes: ['saml', 'github'],
        installedAt: new Date('2000-01-01'),
        installedAtByOldestUser: new Date('2000-01-01'),
        currentUsersCount: 1,
        currentActiveUsersCount: 1,
        currentPagesCount: 1,
      });
    });

    test('Should get correct GROWI info with empty options', async() => {
      // act
      const growiInfo = await growiInfoService.getGrowiInfo({});

      // assert
      assert(growiInfo != null);
      expect(growiInfo.additionalInfo).toBeUndefined();
      expect(growiInfo).toEqual({
        version: appVersion,
        appSiteUrl: 'http://growi.test.jp',
        serviceInstanceId: '',
        type: 'on-premise',
        wikiType: 'closed',
        deploymentType: 'growi-docker-compose',
        osInfo: growiInfo.osInfo, // Keep the osInfo as it's dynamic
      });
    });

  });
});
