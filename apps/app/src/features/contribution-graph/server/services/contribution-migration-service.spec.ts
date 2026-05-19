import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';

import { ContributionGraphActions } from '~/features/contribution-graph/interfaces/supported-actions';
import type { IActivity } from '~/interfaces/activity';
import { MediumActionGroup } from '~/interfaces/activity';
import Activity from '~/server/models/activity';

import Contribution from '../models/contribution-model';
import { ActivityAggregationService } from './activity-aggregation-service';
import { ContributionMigrationService } from './contribution-migration-service';

vi.mock('~/server/service/config-manager/config-manager', () => ({
  configManager: {
    getConfig: vi.fn(),
  },
}));

const activityAggregationService = new ActivityAggregationService();
const contributionMigrationService = new ContributionMigrationService(
  activityAggregationService,
);

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

  it('should create new contribution documents based on activity documents that counts as contributions', async () => {
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
    await contributionMigrationService.migrateContributions(userId);

    // Assert
    const activitiesInDatabase = await Activity.find({ user: userId });
    const contributionsInDatabase = await Contribution.find({ user: userId });

    const startOfDay = new Date('2025-11-03T00:00:00.000Z');
    const endOfDay = new Date('2025-11-04T00:00:00.000Z');

    const sameDayContribution = await Contribution.findOne({
      user: userId,
      date: {
        $gte: startOfDay,
        $lt: endOfDay,
      },
    });

    if (sameDayContribution == null) {
      throw new Error('Test: Contribution migration failed');
    }

    expect(activitiesInDatabase.length).toBe(3);
    expect(contributionsInDatabase.length).toBe(2);
    expect(sameDayContribution.count).toBe(2);

    vi.useRealTimers();
  });

  it('should not create contribution documents from activities that does not count as contributions', async () => {
    // Arrange
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-11-10T00:00:00Z'));

    const pageBookmarkActivity: IActivity = {
      user: userId,
      action: MediumActionGroup.ACTION_PAGE_BOOKMARK,
      createdAt: new Date('2025-11-03T00:00:00Z'), // 7 days ago
    };

    const pageLikeActivity: IActivity = {
      user: userId,
      action: MediumActionGroup.ACTION_PAGE_LIKE,
      createdAt: new Date('2025-11-02T00:00:00Z'), // 8 days ago
    };

    const activities = [pageBookmarkActivity, pageLikeActivity];

    await Activity.insertMany(activities);

    // Act
    await contributionMigrationService.migrateContributions(userId);

    // Assert
    const activitiesInDatabase = await Activity.find({ user: userId });
    const contributionsInDatabase = await Contribution.find({ user: userId });

    expect(activitiesInDatabase.length).toBe(2);
    expect(contributionsInDatabase.length).toBe(0);

    vi.useRealTimers();
  });
});
