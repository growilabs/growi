import type { IPage, IUser } from '@growi/core';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import PageOperation from '~/server/models/page-operation';
import { configManager } from '~/server/service/config-manager';
import type { S2sMessagingService } from '~/server/service/s2s-messaging/base';

import { InstallerService } from './installer';

const ADMIN = {
  name: 'Installer Test Admin',
  username: 'installerTestAdmin',
  email: 'installer-test-admin@example.com',
  password: 'installer-test-password',
} as const;

describe('InstallerService.install', () => {
  let installer: InstallerService;

  beforeAll(async () => {
    configManager.setS2sMessagingService(mock<S2sMessagingService>());
    await configManager.loadConfigs();

    installer = new InstallerService(await getInstance());
  });

  afterAll(async () => {
    // pageService.create leaves its sub-operation running after it resolves;
    // let every one this file started finish before the DB connection closes.
    await vi.waitFor(async () => {
      expect(await PageOperation.countDocuments()).toBe(0);
    }, 10_000);
  });

  it('has created the first admin user and their homepage by the time install resolves', async () => {
    const adminUser = await installer.install(ADMIN, 'en_US');

    expect(adminUser.username).toBe(ADMIN.username);

    const savedUser = await mongoose
      .model<IUser>('User')
      .findOne({ username: ADMIN.username });
    expect(savedUser?.admin).toBe(true);

    const homepage = await mongoose
      .model<IPage>('Page')
      .findOne({ path: `/user/${ADMIN.username}` });
    expect(homepage).not.toBeNull();
  });
});
