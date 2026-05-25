import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';

import { ContributionGraphActions } from '~/features/contribution-graph/interfaces/supported-actions';
import type { IActivity } from '~/interfaces/activity';
import { AllSupportedActions } from '~/interfaces/activity';
import Activity from '~/server/models/activity';
import { configManager } from '~/server/service/config-manager';

import Contribution from '../models/contribution-model';
import { migrateContributions } from './contribution-migration-service';

// Mock configManger to return an Activity TTL of 30 days (default value)
vi.mock('~/server/service/config-manager/config-manager', () => ({
  configManager: { getConfig: vi.fn() },
}));
vi.mocked(configManager.getConfig).mockReturnValue(2592000);

describe('migrateContributions', () => {
  const userId = new mongoose.Types.ObjectId().toString();

  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
  });

  beforeEach(async () => {
    await Activity.deleteMany({});
    await Contribution.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    await mongod.stop();
  });

  it('should create new contribution documents based on activity documents that count as contributions', async () => {
    // Arrange
    vi.useFakeTimers();
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
    expect(sameDayContribution).not.toBeNull();
    expect(contributionsInDatabase.length).toBe(2);
    expect(otherDayContribution!.count).toBe(1);
    expect(sameDayContribution!.count).toBe(2);

    vi.useRealTimers();
  });

  it('should include activity at TTL boundary but exclude activities past it', async () => {
    // Arrange
    vi.useFakeTimers();
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

    vi.useRealTimers();
  });

  it('should not create contribution documents from activities that do not count as contributions', async () => {
    // Arrange
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-11-10T00:00:00Z'));

    const contributionActionValues: readonly string[] = Object.values(
      ContributionGraphActions,
    );
    const nonContributionActions = AllSupportedActions.filter(
      (action) => !contributionActionValues.includes(action),
    );
    const samples = nonContributionActions.slice(0, 2);

    const activities: IActivity[] = samples.map((action, i) => ({
      user: userId,
      action,
      createdAt: new Date(`2025-11-0${3 + i}T00:00:00Z`),
    }));

    await Activity.insertMany(activities);

    // Act
    await migrateContributions(userId);

    // Assert
    const contributionsInDatabase = await Contribution.find({ user: userId });

    expect(contributionsInDatabase.length).toBe(0);

    vi.useRealTimers();
  });

  it('should be idempotent when run twice (count should not change)', async () => {
    // Arrange
    vi.useFakeTimers();
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

    vi.useRealTimers();
  });

  it('should throw if userId is invalid', async () => {
    await expect(migrateContributions('invalid-id')).rejects.toThrow(
      'User ID invalid',
    );
  });
});
