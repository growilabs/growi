import type { IUserHasId } from '@growi/core';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager';

import { findUserPageWriteRefusal } from './user-page-write-guard';

const OWNER_USERNAME = 'userPageWriteGuardOwner';
const OWNER_HOME = `/user/${OWNER_USERNAME}`;
const MISSING_HOME = '/user/userPageWriteGuardNobody';

describe('findUserPageWriteRefusal', () => {
  beforeAll(async () => {
    await getInstance();
    await mongoose.model<IUserHasId>('User').create({
      name: OWNER_USERNAME,
      username: OWNER_USERNAME,
      email: `${OWNER_USERNAME}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
    });
  });

  afterEach(async () => {
    await configManager.updateConfigs(
      { 'security:disableUserPages': undefined },
      { removeIfUndefined: true },
    );
  });

  afterAll(async () => {
    await mongoose.model('User').deleteMany({ username: OWNER_USERNAME });
  });

  describe('with user pages disabled', () => {
    beforeEach(async () => {
      await configManager.updateConfigs({ 'security:disableUserPages': true });
    });

    it.each([
      ['an existing user page', { existingPath: `${OWNER_HOME}/memo` }],
      ['the user list page', { existingPath: '/user' }],
      ['a new user page', { newPath: `${OWNER_HOME}/new` }],
      ['a user home', { newPath: OWNER_HOME }],
      [
        'a move out of a user page',
        { existingPath: `${OWNER_HOME}/memo`, newPath: '/somewhere' },
      ],
      [
        'a move into a user page',
        { existingPath: '/somewhere', newPath: `${OWNER_HOME}/memo` },
      ],
    ])('refuses %s', async (_label, paths) => {
      await expect(findUserPageWriteRefusal(paths)).resolves.toBe(
        'user-pages-disabled',
      );
    });

    it('allows paths outside /user', async () => {
      await expect(
        findUserPageWriteRefusal({
          existingPath: '/users-guide',
          newPath: '/userland/page',
        }),
      ).resolves.toBeNull();
    });
  });

  describe('with user pages enabled', () => {
    it('allows writing under an existing user home', async () => {
      await expect(
        findUserPageWriteRefusal({
          existingPath: `${OWNER_HOME}/memo`,
          newPath: `${OWNER_HOME}/new`,
        }),
      ).resolves.toBeNull();
    });

    it('refuses a new path under the home of a user who does not exist', async () => {
      await expect(
        findUserPageWriteRefusal({ newPath: `${MISSING_HOME}/new` }),
      ).resolves.toBe('user-home-owner-missing');
    });

    // update-page checks only the disabled setting for a page being written in place.
    it('does not ask whether the owner exists for an existing page', async () => {
      await expect(
        findUserPageWriteRefusal({ existingPath: `${MISSING_HOME}/old` }),
      ).resolves.toBeNull();
    });
  });
});
