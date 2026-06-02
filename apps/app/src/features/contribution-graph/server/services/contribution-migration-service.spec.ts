import type { IUserHasId } from '@growi/core';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';

import { ContributionGraphActions } from '~/features/contribution-graph/interfaces/supported-actions';
import type { IActivity } from '~/interfaces/activity';
import { SupportedAction } from '~/interfaces/activity';
import Activity from '~/server/models/activity';
import { configManager } from '~/server/service/config-manager';

import Contribution from '../models/contribution-model';
import {
  ensureUserHasMigrated,
  migrateContributions,
} from './contribution-migration-service';

// Mock configManger to return an Activity TTL of 30 days (default value)
vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: vi.fn() },
}));
vi.mocked(configManager.getConfig).mockReturnValue(2592000);

describe('migrateContributions', () => {
  const userId = new mongoose.Types.ObjectId().toString();

  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    vi.useRealTimers();
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
  });

  beforeEach(async () => {
    vi.useFakeTimers();
    await Activity.deleteMany({});
    await Contribution.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    await mongod.stop();
    vi.useRealTimers();
  });

  it('should create new contribution documents based on activity documents that count as contributions', async () => {
    // Arrange
    vi.setSystemTime(new Date('2025-11-10T00:00:00Z'));

    const pageCreateActivity: IActivity = {
      user: userId,
      action: ContributionGraphActions.ACTION_PAGE_CREATE,
      createdAt: new Date('2025-11-03T00:00:00Z'), // 7 days ago
    };

    const pageUpdateActivity: IActivity = {
      user: userId,
      action: ContributionGraphActions.ACTION_PAGE_UPDATE,
      createdAt: new Date('2025-11-03T10:00:00Z'), // 7 days ago
    };

    const commentCreateActivity: IActivity = {
      user: userId,
      action: ContributionGraphActions.ACTION_COMMENT_CREATE,
      createdAt: new Date('2025-11-06T10:00:00Z'), // 4 days ago
    };

    const activities = [
      pageCreateActivity,
      pageUpdateActivity,
      commentCreateActivity,
    ];

    await Activity.insertMany(activities);

    // Act
    await migrateContributions(userId);

    // Assert
    const contributionsInDatabase = await Contribution.find({ user: userId });

    const sameDayContribution = await Contribution.findOne({
      user: userId,
      date: {
        $gte: new Date('2025-11-03T00:00:00.000Z'), // 7 days ago
        $lt: new Date('2025-11-04T00:00:00.000Z'), // 8 days ago,
      },
    });

    const otherDayContribution = await Contribution.findOne({
      user: userId,
      date: {
        $gte: new Date('2025-11-06T00:00:00.000Z'), // 4 days ago
        $lt: new Date('2025-11-07T00:00:00.000Z'), // 5 days ago
      },
    });

    expect(sameDayContribution).not.toBeNull();
    expect(contributionsInDatabase.length).toBe(2);
    expect(otherDayContribution!.count).toBe(1);
    expect(sameDayContribution!.count).toBe(2);
  });

  it('should include activity at TTL boundary but exclude activities past it', async () => {
    // Arrange
    vi.setSystemTime(new Date('2025-11-10T00:00:00Z'));

    const commentCreateActivity: IActivity = {
      user: userId,
      action: ContributionGraphActions.ACTION_COMMENT_CREATE,
      createdAt: new Date('2025-10-11T00:00:00Z'), // 30 days ago
    };

    const pageCreateActivity: IActivity = {
      user: userId,
      action: ContributionGraphActions.ACTION_PAGE_CREATE,
      createdAt: new Date('2025-10-10T00:00:00Z'), // 31 days ago
    };

    const pageUpdateActivity: IActivity = {
      user: userId,
      action: ContributionGraphActions.ACTION_PAGE_UPDATE,
      createdAt: new Date('2025-10-09T00:00:00Z'), // 32 days ago
    };

    const activities = [
      commentCreateActivity,
      pageCreateActivity,
      pageUpdateActivity,
    ];

    await Activity.insertMany(activities);

    // Act
    await migrateContributions(userId);

    // Assert
    const contributionsInDatabase = await Contribution.find({ user: userId });

    expect(contributionsInDatabase.length).toBe(1);
    expect(contributionsInDatabase[0].date).toStrictEqual(
      new Date('2025-10-11T00:00:00Z'),
    ); // Exactly 30 days ago gets migrated
  });

  it('should not create contribution documents from activities that do not count as contributions', async () => {
    // Arrange
    vi.setSystemTime(new Date('2025-11-10T00:00:00Z'));

    const loginFailureActivity: IActivity = {
      user: userId,
      action: SupportedAction.ACTION_USER_LOGIN_FAILURE,
      createdAt: new Date('2025-11-03T00:00:00Z'), // 7 days ago
    };

    const passwordResetActivity: IActivity = {
      user: userId,
      action: SupportedAction.ACTION_USER_RESET_PASSWORD,
      createdAt: new Date('2025-11-04T00:00:00Z'), // 8 days ago
    };

    const activities: IActivity[] = [
      loginFailureActivity,
      passwordResetActivity,
    ];

    await Activity.insertMany(activities);

    // Act
    await migrateContributions(userId);

    // Assert
    const contributionsInDatabase = await Contribution.find({ user: userId });

    expect(contributionsInDatabase.length).toBe(0);
  });

  it('should be idempotent when run twice (count should not change)', async () => {
    // Arrange
    vi.setSystemTime(new Date('2025-11-10T00:00:00Z'));

    const pageUpdateActivity: IActivity = {
      user: userId,
      action: ContributionGraphActions.ACTION_PAGE_UPDATE,
      createdAt: new Date('2025-11-05T00:00:00Z'), // 5 days ago
    };

    await Activity.create(pageUpdateActivity);
    await migrateContributions(userId);

    // Make sure first migration is successful
    const contributionsInDatabaseOnFirstMigration = await Contribution.find({
      user: userId,
    });
    expect(contributionsInDatabaseOnFirstMigration[0].count).toBe(1);

    // Act (Run migration for a second time)
    await migrateContributions(userId);

    // Assert
    const contributionsInDatabase = await Contribution.find({ user: userId });

    expect(contributionsInDatabase.length).toBe(1);
    expect(contributionsInDatabase[0].count).toBe(1);
  });

  it.each([
    ['null', null, 'User ID invalid'],
    ['undefined', undefined, 'User ID invalid'],
    ['empty string', '', 'User ID invalid'],
    ['invalid id', 'invalid-id', 'User ID invalid'],
  ])('should throw when user is %s', async (_label, value, expectedMessage) => {
    await expect(
      // @ts-expect-error - testing runtime invalid-input handling
      migrateContributions(value),
    ).rejects.toThrow(expectedMessage);

    expect(await Contribution.countDocuments()).toBe(0);
  });
});

describe('ensureUserHasMigrated', () => {
  const userSchema = new mongoose.Schema({
    contributionsMigratedAt: { type: Date },
  });
  // Avoid re-registering if the test file is re-evaluated
  if (mongoose.models.User == null) {
    mongoose.model('User', userSchema);
  }

  // Helper to build a complete IUserHasId
  const buildUser = (overrides: Partial<IUserHasId> = {}): IUserHasId =>
    ({
      _id: new mongoose.Types.ObjectId().toString(),
      name: 'tester',
      username: 'tester',
      email: 'test@test.com',
      password: 'pwd',
      imageUrlCached: 'url',
      isEmailPublished: true,
      isGravatarEnabled: false,
      admin: false,
      readOnly: false,
      isInvitationEmailSended: true,
      lang: 'en_US',
      createdAt: new Date(),
      introduction: '',
      status: 1,
      ...overrides,
    }) as IUserHasId;

  let mongod: MongoMemoryServer;
  let User: mongoose.Model<{ contributionsMigratedAt?: Date }>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    User = mongoose.model('User');
  });

  beforeEach(async () => {
    vi.useFakeTimers();
    await Activity.deleteMany({});
    await Contribution.deleteMany({});
    await User.deleteMany({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    await mongod.stop();
  });

  it('should throw error if user object is not populated', async () => {
    const userId = new mongoose.Types.ObjectId().toString();

    await expect(ensureUserHasMigrated(userId)).rejects.toThrow(/not found/);
  });

  it('should throw when the user does not exist in the database', async () => {
    const user = buildUser(); // valid id, but no user document in DB

    await Activity.create({
      user: user._id,
      action: ContributionGraphActions.ACTION_PAGE_CREATE,
      createdAt: new Date(),
    });

    await expect(ensureUserHasMigrated(user)).rejects.toThrow(/not found/);
    expect(await Contribution.countDocuments()).toBe(0);
  });

  it('should return without re-running migration if fresh DB user is already migrated', async () => {
    const dbUser = await User.create({
      contributionsMigratedAt: new Date('2025-01-01T00:00:00Z'),
    });
    // Caller passes a stale user object with no contributionsMigratedAt
    const staleUser = buildUser({ _id: dbUser._id.toString() });

    // Activity that would become a contribution if migration ran
    await Activity.create({
      user: dbUser._id.toString(),
      action: ContributionGraphActions.ACTION_PAGE_CREATE,
      createdAt: new Date(),
    });

    await ensureUserHasMigrated(staleUser);

    expect(await Contribution.countDocuments()).toBe(0);
  });

  it('should run migration and set contributionsMigratedAt when user has not been migrated', async () => {
    vi.setSystemTime(new Date('2025-11-10T00:00:00Z'));

    const dbUser = await User.create({}); // no contributionsMigratedAt
    const user = buildUser({ _id: dbUser._id.toString() });

    await Activity.create({
      user: dbUser._id.toString(),
      action: ContributionGraphActions.ACTION_PAGE_CREATE,
      createdAt: new Date('2025-11-05T00:00:00Z'),
    });

    await ensureUserHasMigrated(user);

    const contributions = await Contribution.find({
      user: dbUser._id.toString(),
    });
    expect(contributions).toHaveLength(1);
    expect(contributions[0].count).toBe(1);

    const updated = await User.findById(dbUser._id);
    expect(updated?.contributionsMigratedAt).toEqual(
      new Date('2025-11-10T00:00:00Z'),
    );
  });
});
