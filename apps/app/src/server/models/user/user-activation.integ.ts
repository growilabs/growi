import type { IPage } from '@growi/core';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import type { PageModel } from '~/server/models/page';
import PageOperation from '~/server/models/page-operation';
import { configManager } from '~/server/service/config-manager';
import type { S2sMessagingService } from '~/server/service/s2s-messaging/base';

import { UserStatus } from './conts';

const USERNAMES = {
  created: 'activationTestCreatedUser',
  activatedByAdmin: 'activationTestActivatedByAdmin',
  invited: 'activationTestInvitedUser',
} as const;

const HOME_PAGE_PATHS = Object.values(USERNAMES).map((u) => `/user/${u}`);

const findHomePage = (username: string) =>
  mongoose.model<IPage>('Page').findOne({ path: `/user/${username}` });

describe('User activation', () => {
  // biome-ignore lint/suspicious/noExplicitAny: the User model is untyped JS
  let User: any;

  beforeAll(async () => {
    configManager.setS2sMessagingService(mock<S2sMessagingService>());
    await configManager.loadConfigs();

    await getInstance();
    await configManager.updateConfig('app:isV5Compatible', true);

    User = mongoose.model('User');

    // Home pages are created under the root page, so the page tree needs one
    const Page = mongoose.model<IPage, PageModel>('Page');
    if ((await Page.findOne({ path: '/' })) == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }
  });

  afterAll(async () => {
    // pageService.create leaves its sub-operation running after it resolves;
    // let it finish so it does not outlive this file's DB connection.
    await vi.waitFor(async () => {
      expect(
        await PageOperation.countDocuments({
          fromPath: { $in: HOME_PAGE_PATHS },
        }),
      ).toBe(0);
    }, 5000);

    await User.deleteMany({ username: { $in: Object.values(USERNAMES) } });
    await mongoose.model('Page').deleteMany({ path: { $in: HOME_PAGE_PATHS } });
  });

  it('has created the home page by the time createUser resolves for an active user', async () => {
    await User.createUser(
      'Created User',
      USERNAMES.created,
      `${USERNAMES.created}@example.com`,
      'password',
      'en_US',
      UserStatus.STATUS_ACTIVE,
    );

    expect(await findHomePage(USERNAMES.created)).not.toBeNull();
  });

  it('has created the home page by the time statusActivate resolves', async () => {
    const user = await User.create({
      name: 'Activated By Admin',
      username: USERNAMES.activatedByAdmin,
      email: `${USERNAMES.activatedByAdmin}@example.com`,
      status: UserStatus.STATUS_REGISTERED,
    });

    await user.statusActivate();

    expect(await findHomePage(USERNAMES.activatedByAdmin)).not.toBeNull();
  });

  it('has saved the user and created the home page by the time activateInvitedUser resolves', async () => {
    const { user } = await User.createUserByEmail(
      `${USERNAMES.invited}@example.com`,
    );
    expect(user.status).toBe(UserStatus.STATUS_INVITED);

    await user.activateInvitedUser(USERNAMES.invited, 'Invited User', 'pass');

    const saved = await User.findById(user._id);
    expect(saved.status).toBe(UserStatus.STATUS_ACTIVE);
    expect(saved.username).toBe(USERNAMES.invited);
    expect(await findHomePage(USERNAMES.invited)).not.toBeNull();
  });
});
