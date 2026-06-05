import type { IUser } from '@growi/core';
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
  resolveContributor,
} from './contribution-migration-service';

// Mock configManger to return an Activity TTL of 30 days (default value)
vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: vi.fn() },
}));
vi.mocked(configManager.getConfig).mockReturnValue(2592000);

// Register the User model once; shared by the ensureUserHasMigrated and
// resolveContributor suites below.
if (mongoose.models.User == null) {
  mongoose.model(
    'User',
    new mongoose.Schema({ contributionsMigratedAt: { type: Date } }),
  );
}
const User: mongoose.Model<{ contributionsMigratedAt?: Date }> =
  mongoose.model<IUser>('User');

// A single in-memory MongoDB instance is shared across every suite in this file.
let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

// Suites below enable fake timers per-test; always restore real timers afterward
// so the shared async teardown is unaffected.
afterEach(() => {
  vi.useRealTimers();
});

describe('migrateContributions', () => {
  const userId = new mongoose.Types.ObjectId().toString();

  beforeEach(async () => {
    vi.useFakeTimers();
    await Activity.deleteMany({});
    await Contribution.deleteMany({});
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
  beforeEach(async () => {
    vi.useFakeTimers();
    await Activity.deleteMany({});
    await Contribution.deleteMany({});
    await User.deleteMany({});
  });

  it('should return without re-running migration if the user is already migrated', async () => {
    const dbUser = await User.create({
      contributionsMigratedAt: new Date('2025-01-01T00:00:00Z'),
    });

    // Activity that would become a contribution if migration ran
    await Activity.create({
      user: dbUser._id.toString(),
      action: ContributionGraphActions.ACTION_PAGE_CREATE,
      createdAt: new Date(),
    });

    await ensureUserHasMigrated(dbUser);

    expect(await Contribution.countDocuments()).toBe(0);
  });

  it('should run migration and set contributionsMigratedAt when user has not been migrated', async () => {
    vi.setSystemTime(new Date('2025-11-10T00:00:00Z'));

    const dbUser = await User.create({}); // no contributionsMigratedAt

    await Activity.create({
      user: dbUser._id.toString(),
      action: ContributionGraphActions.ACTION_PAGE_CREATE,
      createdAt: new Date('2025-11-05T00:00:00Z'),
    });

    await ensureUserHasMigrated(dbUser);

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

  it('does not re-run migration when another path already claimed it, even if the input object is stale', async () => {
    const migratedAt = new Date('2025-01-01T00:00:00Z');
    const dbUser = await User.create({ contributionsMigratedAt: migratedAt });

    // An activity that would produce a contribution if migration re-ran.
    await Activity.create({
      user: dbUser._id.toString(),
      action: ContributionGraphActions.ACTION_PAGE_CREATE,
      createdAt: new Date(),
    });

    const staleUser = { _id: dbUser._id, contributionsMigratedAt: null };
    await ensureUserHasMigrated(staleUser);

    expect(await Contribution.countDocuments()).toBe(0);
    // The existing timestamp must be left untouched (claim only $sets on null).
    const reloaded = await User.findById(dbUser._id);
    expect(reloaded?.contributionsMigratedAt).toEqual(migratedAt);
  });

  it('releases the claim when migration fails so a later trigger retries successfully', async () => {
    vi.setSystemTime(new Date('2025-11-10T00:00:00Z'));

    const dbUser = await User.create({}); // no contributionsMigratedAt
    await Activity.create({
      user: dbUser._id.toString(),
      action: ContributionGraphActions.ACTION_PAGE_CREATE,
      createdAt: new Date('2025-11-05T00:00:00Z'),
    });

    // First trigger: fail the migration write once, then let the spy call through
    // so the retry below exercises the real write path.
    const bulkWriteSpy = vi
      .spyOn(Contribution, 'bulkWrite')
      .mockRejectedValueOnce(new Error('write failed'));

    try {
      await expect(ensureUserHasMigrated(dbUser)).rejects.toThrow(
        'write failed',
      );
      expect(await Contribution.countDocuments()).toBe(0);

      // Second trigger (write now succeeds): this only backfills if the claim was
      // released. If the failed run had left the user flagged as migrated, the
      // one-shot guard would skip and no contribution would be created.
      await ensureUserHasMigrated({
        _id: dbUser._id,
        contributionsMigratedAt: null,
      });

      const contributions = await Contribution.find({
        user: dbUser._id.toString(),
      });
      expect(contributions).toHaveLength(1);
      expect(contributions[0].count).toBe(1);
    } finally {
      bulkWriteSpy.mockRestore();
    }
  });
});

describe('resolveContributor', () => {
  beforeEach(async () => {
    await Activity.deleteMany({});
    await User.deleteMany({});
  });

  it('takes the fast path: returns the passed contributor regardless of DB state', async () => {
    const contributor = {
      _id: new mongoose.Types.ObjectId(),
      contributionsMigratedAt: null,
    };

    // No activity exists for this id. The fast path must return the contributor
    // without consulting the database — if it looked the activity up, it would
    // resolve to null instead. This holds regardless of how the lookup is
    // implemented (findById, findOne, aggregation, ...).
    const result = await resolveContributor(
      new mongoose.Types.ObjectId().toString(),
      contributor,
    );

    expect(result).toBe(contributor);
  });

  it('takes the fallback path: resolves the activity user when no contributor is passed', async () => {
    const dbUser = await User.create({});
    const activity = await Activity.create({
      user: dbUser._id,
      action: ContributionGraphActions.ACTION_PAGE_CREATE,
      createdAt: new Date(),
    });

    // With no contributor, the DB is the only possible source of this user,
    // so returning it proves the fallback lookup ran.
    const result = await resolveContributor(activity._id.toString(), null);

    expect(result?._id.toString()).toBe(dbUser._id.toString());
  });

  it('returns null when the activity has no associated user', async () => {
    const activity = await Activity.create({
      action: ContributionGraphActions.ACTION_PAGE_CREATE,
      createdAt: new Date(),
    });

    const result = await resolveContributor(activity._id.toString(), null);

    expect(result).toBeNull();
  });
});
