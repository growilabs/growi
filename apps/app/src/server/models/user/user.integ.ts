import type mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { configManager } from '~/server/service/config-manager';
import type { S2sMessagingService } from '~/server/service/s2s-messaging/base';

import { UserStatus } from './conts';

describe('User', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let User: any;
  let adminusertestToBeRemovedId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    // Initialize configManager
    const s2sMessagingServiceMock = mock<S2sMessagingService>();
    configManager.setS2sMessagingService(s2sMessagingServiceMock);
    await configManager.loadConfigs();

    // Initialize User model without Crowi using dynamic import
    const userModule = await import('./index');
    const userFactory = userModule.default;
    User = userFactory(null);

    await User.insertMany([
      {
        name: 'Example for User Test',
        username: 'usertest',
        email: 'usertest@example.com',
        password: 'usertestpass',
        lang: 'en_US',
      },
      {
        name: 'Admin Example Active',
        username: 'adminusertest1',
        email: 'adminusertest1@example.com',
        password: 'adminusertestpass',
        admin: true,
        status: UserStatus.STATUS_ACTIVE,
        lang: 'en_US',
      },
      {
        name: 'Admin Example Suspended',
        username: 'adminusertest2',
        email: 'adminusertes2@example.com',
        password: 'adminusertestpass',
        admin: true,
        status: UserStatus.STATUS_SUSPENDED,
        lang: 'en_US',
      },
      {
        name: 'Admin Example to delete',
        username: 'adminusertestToBeRemoved',
        email: 'adminusertestToBeRemoved@example.com',
        password: 'adminusertestpass',
        admin: true,
        status: UserStatus.STATUS_ACTIVE,
        lang: 'en_US',
      },
    ]);

    // delete adminusertestToBeRemoved
    const adminusertestToBeRemoved = await User.findOne({
      username: 'adminusertestToBeRemoved',
    });
    adminusertestToBeRemovedId = adminusertestToBeRemoved._id;
    await adminusertestToBeRemoved.statusDelete();
  });

  describe('Create and Find.', () => {
    describe('The user', () => {
      // Skip: This test requires crowi instance to generate password
      test.skip('should created with createUserByEmailAndPassword', async () => {
        await new Promise<void>((resolve, reject) => {
          User.createUserByEmailAndPassword(
            'Example2 for User Test',
            'usertest2',
            'usertest2@example.com',
            'usertest2pass',
            'en_US',
            (err: Error | null, userData: typeof User) => {
              try {
                expect(err).toBeNull();
                expect(userData).toBeInstanceOf(User);
                expect(userData.name).toBe('Example2 for User Test');
                resolve();
              } catch (error) {
                reject(error);
              }
            },
          );
        });
      });

      test('should be found by findUserByUsername', async () => {
        const user = await User.findUserByUsername('usertest');
        expect(user).toBeInstanceOf(User);
        expect(user.name).toBe('Example for User Test');
      });
    });
  });

  describe('Delete.', () => {
    describe('Deleted users', () => {
      test('should have correct attributes', async () => {
        const adminusertestToBeRemoved = await User.findOne({
          _id: adminusertestToBeRemovedId,
        });

        expect(adminusertestToBeRemoved).toBeInstanceOf(User);
        expect(adminusertestToBeRemoved.name).toBe('');
        expect(adminusertestToBeRemoved.password).toBe('');
        expect(adminusertestToBeRemoved.googleId).toBeNull();
        expect(adminusertestToBeRemoved.isGravatarEnabled).toBeFalsy();
        expect(adminusertestToBeRemoved.image).toBeNull();
      });
    });
  });

  describe('User.findAdmins', () => {
    test('should retrieves only active users', async () => {
      const users = await User.findAdmins();
      const adminusertestActive = users.find(
        (user: { username: string }) => user.username === 'adminusertest1',
      );
      const adminusertestSuspended = users.find(
        (user: { username: string }) => user.username === 'adminusertest2',
      );
      const adminusertestToBeRemoved = users.find(
        (user: { _id: mongoose.Types.ObjectId }) =>
          user._id.toString() === adminusertestToBeRemovedId.toString(),
      );

      expect(adminusertestActive).toBeInstanceOf(User);
      expect(adminusertestSuspended).toBeUndefined();
      expect(adminusertestToBeRemoved).toBeUndefined();
    });

    test("with 'includesInactive' option should retrieves suspended users", async () => {
      const users = await User.findAdmins({
        status: [UserStatus.STATUS_ACTIVE, UserStatus.STATUS_SUSPENDED],
      });
      const adminusertestActive = users.find(
        (user: { username: string }) => user.username === 'adminusertest1',
      );
      const adminusertestSuspended = users.find(
        (user: { username: string }) => user.username === 'adminusertest2',
      );
      const adminusertestToBeRemoved = users.find(
        (user: { _id: mongoose.Types.ObjectId }) =>
          user._id.toString() === adminusertestToBeRemovedId.toString(),
      );

      expect(adminusertestActive).toBeInstanceOf(User);
      expect(adminusertestSuspended).toBeInstanceOf(User);
      expect(adminusertestToBeRemoved).toBeUndefined();
    });
  });

  describe('User Utilities', () => {
    describe('Get user exists from user page path', () => {
      test('found', async () => {
        const userPagePath = '/user/usertest';
        const isExist = await User.isExistUserByUserPagePath(userPagePath);

        expect(isExist).toBe(true);
      });

      test('not found', async () => {
        const userPagePath = '/user/usertest-hoge';
        const isExist = await User.isExistUserByUserPagePath(userPagePath);

        expect(isExist).toBe(false);
      });
    });
  });
});
