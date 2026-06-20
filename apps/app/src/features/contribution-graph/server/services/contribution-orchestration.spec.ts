import { EventEmitter } from 'node:events';
import type { IUser } from '@growi/core';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';

import { SupportedAction } from '~/interfaces/activity';
import Activity from '~/server/models/activity';
import ActivityService from '~/server/service/activity';
import { configManager } from '~/server/service/config-manager';

import Contribution from '../models/contribution-model';

// Set the Activity TTL to the 30-day default
vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: vi.fn() },
}));
vi.mocked(configManager.getConfig).mockReturnValue(2592000);

// Minimal User schema (only the field the migration logic reads). Guarded
// against duplicate registration across specs in the same process.
if (mongoose.models.User == null) {
  mongoose.model(
    'User',
    new mongoose.Schema({ contributionsMigratedAt: { type: Date } }),
  );
}
const User = mongoose.model<IUser>('User');

/**
 * Builds a real ActivityService wired to a bare EventEmitter, mirroring how
 * crowi.events.activity is an EventEmitter at runtime. Returns the registered
 * 'update' listener so the test can await the full orchestration deterministically
 * (emit() is fire-and-forget and would race the assertions).
 */
const buildUpdateListener = () => {
  const activityEvent = new EventEmitter();
  const crowi = {
    events: { activity: activityEvent },
    // auditLogEnabled falsy -> getAvailableActions() returns AllEssentialActions
    // (which includes ACTION_PAGE_CREATE), so shoudUpdate is true and
    // updateByParameters runs to settle the activity.
    configManager: { getConfig: vi.fn().mockReturnValue(undefined) },
  };

  // eslint-disable-next-line no-new -- constructor registers the event listeners
  new ActivityService(crowi as never);

  return activityEvent.listeners('update')[0] as (
    activityId: string,
    parameters: Record<string, unknown>,
    target: unknown,
  ) => Promise<void>;
};

describe('ActivityService contribution orchestration', () => {
  const userId = new mongoose.Types.ObjectId();
  const pageId = new mongoose.Types.ObjectId();

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

  beforeEach(async () => {
    await Activity.deleteMany({});
    await Contribution.deleteMany({});
    await User.deleteMany({});
  });

  it("counts a user's first contribution exactly once (count is 1, not 2)", async () => {
    // Arrange
    await User.create({ _id: userId }); // Un-migrated user

    // Still-unsettled Activity for the current event
    const unsettledActivity = await Activity.create({
      user: userId,
      target: pageId,
      action: SupportedAction.ACTION_UNSETTLED,
    });

    const updateListener = buildUpdateListener();

    // Act: invoke the 'update' handler directly. It runs the real
    // resolveContributor -> ensureUserHasMigrated -> addContribution sequence,
    // then updateByParameters which settles the activity.
    await updateListener(
      unsettledActivity._id.toString(),
      {
        action: SupportedAction.ACTION_PAGE_CREATE,
        target: pageId,
        contributor: { _id: userId },
      },
      { _id: pageId },
    );

    // Assert the contract: the event is counted once. Summing across documents
    // (rather than reading a single day) keeps the assertion robust even if a
    // regression splits the double count across two date keys.
    const contributions = await Contribution.find({ user: userId });
    const totalCount = contributions.reduce((sum, c) => sum + c.count, 0);
    expect(totalCount).toBe(1);

    // The activity must end up settled to its real contribution action.
    const settled = await Activity.findById(unsettledActivity._id);
    expect(settled?.action).toBe(SupportedAction.ACTION_PAGE_CREATE);
  });
});
