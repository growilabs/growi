import type mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type UserEvent from '~/server/events/user';
import { configManager } from '~/server/service/config-manager';
import type { S2sMessagingService } from '~/server/service/s2s-messaging/base';

import { UserStatus } from './conts';
import {
  buildUsernamePrefixRange,
  USERNAME_CI_COLLATION,
} from './username-prefix-range';

describe('User', () => {
  let User: any;
  let adminusertestToBeRemovedId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    // Initialize configManager
    const s2sMessagingServiceMock = mock<S2sMessagingService>();
    configManager.setS2sMessagingService(s2sMessagingServiceMock);
    await configManager.loadConfigs();

    // Mock Crowi instance with required properties
    const crowiMock = mock<Crowi>({
      events: {
        user: mock<UserEvent>({
          on: vi.fn(),
        }),
      },
      env: {
        PASSWORD_SEED: 'testPasswordSeed',
      },
    });

    // Initialize User model with mocked Crowi using dynamic import
    const userModule = await import('./index');
    const userFactory = userModule.default;
    User = userFactory(crowiMock);

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
      test('should created with createUserByEmailAndPassword', async () => {
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

  describe('User.findUserByUsernamePrefix', () => {
    afterEach(async () => {
      await User.deleteMany({ username: { $regex: '^regexTest' } });
    });

    test('matches usernames by prefix', async () => {
      await User.create({
        name: 'Regex Test',
        username: 'regexTestJohnson',
        email: 'regexTestJohnson1@example.com',
        password: 'regexTestPass',
        lang: 'en_US',
        status: UserStatus.STATUS_ACTIVE,
      });

      const { users, totalCount } = await User.findUserByUsernamePrefix(
        'regexTestJohn',
        [UserStatus.STATUS_ACTIVE],
        // The count is opt-in; without this the caller gets the page only.
        { offset: 0, limit: 10, withTotalCount: true },
      );

      expect(users.map((u: { username: string }) => u.username)).toEqual([
        'regexTestJohnson',
      ]);
      expect(totalCount).toBe(1);
    });

    test('omits the total count unless it is asked for', async () => {
      await User.create({
        name: 'Regex Test',
        username: 'regexTestJohnson',
        email: 'regexTestJohnsonNoCount@example.com',
        password: 'regexTestPass',
        lang: 'en_US',
        status: UserStatus.STATUS_ACTIVE,
      });

      const result = await User.findUserByUsernamePrefix(
        'regexTestJohn',
        [UserStatus.STATUS_ACTIVE],
        { offset: 0, limit: 10 },
      );

      expect(result.users).toHaveLength(1);
      expect(result.totalCount).toBeUndefined();
    });

    // The deliberate behaviour change: this used to match, at the cost of a walk
    // of the whole username index.
    test('does not match a mid-string occurrence', async () => {
      await User.create({
        name: 'Regex Test',
        username: 'regexTestJohnson',
        email: 'regexTestJohnson2@example.com',
        password: 'regexTestPass',
        lang: 'en_US',
        status: UserStatus.STATUS_ACTIVE,
      });

      const { users } = await User.findUserByUsernamePrefix(
        'hnso',
        [UserStatus.STATUS_ACTIVE],
        { offset: 0, limit: 10 },
      );

      expect(users).toEqual([]);
    });

    test('matches regardless of the case of either side', async () => {
      await User.create({
        name: 'Regex Test',
        // Capitals after the prefix, not at the start: afterEach deletes by a
        // case-sensitive /^regexTest/.
        username: 'regexTestCAPITALISED',
        email: 'regexTestCapital@example.com',
        password: 'regexTestPass',
        lang: 'en_US',
        status: UserStatus.STATUS_ACTIVE,
      });

      // Stored capitalised, searched lowercase: fails if `.collation()` is dropped.
      const lower = await User.findUserByUsernamePrefix(
        'regextestcapital',
        [UserStatus.STATUS_ACTIVE],
        { offset: 0, limit: 10 },
      );
      expect(lower.users.map((u: { username: string }) => u.username)).toEqual([
        'regexTestCAPITALISED',
      ]);

      // …and the other direction.
      const upper = await User.findUserByUsernamePrefix(
        'REGEXTESTCAPITAL',
        [UserStatus.STATUS_ACTIVE],
        { offset: 0, limit: 10 },
      );
      expect(upper.users.map((u: { username: string }) => u.username)).toEqual([
        'regexTestCAPITALISED',
      ]);
    });

    // Proves the upper bound against a real collated index: the increment form
    // (`…z` + 1 = `…{`) sorts under the prefix and matches nothing.
    test('matches a prefix ending in a high letter', async () => {
      await User.create({
        name: 'Regex Test',
        username: 'regexTestKahz',
        email: 'regexTestKahz@example.com',
        password: 'regexTestPass',
        lang: 'en_US',
        status: UserStatus.STATUS_ACTIVE,
      });

      const { users } = await User.findUserByUsernamePrefix(
        'regexTestKahz',
        [UserStatus.STATUS_ACTIVE],
        { offset: 0, limit: 10 },
      );

      expect(users.map((u: { username: string }) => u.username)).toEqual([
        'regexTestKahz',
      ]);
    });

    test('treats regex metacharacters in the query as literal characters', async () => {
      await User.create({
        name: 'Regex Test',
        username: 'regexTestJohn.doe',
        email: 'regexTestJohnDotDoe@example.com',
        password: 'regexTestPass',
        lang: 'en_US',
        status: UserStatus.STATUS_ACTIVE,
      });
      await User.create({
        name: 'Regex Test',
        username: 'regexTestJohnXdoe',
        email: 'regexTestJohnXDoe@example.com',
        password: 'regexTestPass',
        lang: 'en_US',
        status: UserStatus.STATUS_ACTIVE,
      });

      const { users } = await User.findUserByUsernamePrefix(
        'regexTestJohn.doe',
        [UserStatus.STATUS_ACTIVE],
        { offset: 0, limit: 10 },
      );

      expect(users.map((u: { username: string }) => u.username)).toEqual([
        'regexTestJohn.doe',
      ]);
    });

    // A cost guard: every case above still passes if the index disappears, since
    // only the work changes. `totalDocsExamined` is the load-bearing assertion —
    // without a usable index the query becomes a collection scan, where
    // keysExamined is 0 and would satisfy a keys-only check.
    test('proving a no-match keyword costs neither an index walk nor a collection scan', async () => {
      // So a slow index build cannot look like a missing index.
      await User.init();

      const range = buildUsernamePrefixRange('regexTestNobodyIsCalledThis');
      const explain = await User.find({
        username: range,
        status: { $in: [UserStatus.STATUS_ACTIVE] },
      })
        .collation(USERNAME_CI_COLLATION)
        .sort({ username: 1 })
        .limit(5)
        .explain('executionStats');

      const { nReturned, totalKeysExamined, totalDocsExamined } =
        explain.executionStats;

      expect(nReturned).toBe(0);
      // Ceilings, not exact expectations.
      expect(totalDocsExamined).toBeLessThan(10);
      expect(totalKeysExamined).toBeLessThan(10);
      // Named deliberately: the case-sensitive index also bounds this range, but
      // silently stops matching capitalised usernames.
      expect(JSON.stringify(explain.queryPlanner.winningPlan)).toContain(
        'username_ci',
      );
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
