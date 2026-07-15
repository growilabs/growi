import { EventEmitter } from 'node:events';
import type { IUser } from '@growi/core';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';

import {
  SupportedAction,
  type SupportedActionType,
} from '~/interfaces/activity';
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

  /**
   * Arrange an un-migrated user + a still-unsettled Activity, then drive the real
   * 'update' handler with the given action. The handler runs the full
   * resolveContributor -> ensureUserHasMigrated -> addContribution sequence and
   * then settles the activity via updateByParameters. Returns the activity id so
   * callers can assert on the settled action.
   */
  const settleViaUpdateListener = async (
    action: SupportedActionType,
  ): Promise<mongoose.Types.ObjectId> => {
    await User.create({ _id: userId }); // un-migrated user

    const unsettledActivity = await Activity.create({
      user: userId,
      target: pageId,
      action: SupportedAction.ACTION_UNSETTLED,
    });

    const updateListener = buildUpdateListener();
    await updateListener(
      unsettledActivity._id.toString(),
      { action, target: pageId, contributor: { _id: userId } },
      { _id: pageId },
    );

    return unsettledActivity._id;
  };

  const totalContributionCount = async (): Promise<number> => {
    const contributions = await Contribution.find({ user: userId });
    return contributions.reduce((sum, c) => sum + c.count, 0);
  };

  it("counts a user's first contribution exactly once (count is 1, not 2)", async () => {
    const activityId = await settleViaUpdateListener(
      SupportedAction.ACTION_PAGE_CREATE,
    );

    expect(await totalContributionCount()).toBe(1);

    const settled = await Activity.findById(activityId);
    expect(settled?.action).toBe(SupportedAction.ACTION_PAGE_CREATE);
  });

  it('counts a single-page revert as a contribution and settles the action', async () => {
    const activityId = await settleViaUpdateListener(
      SupportedAction.ACTION_PAGE_REVERT,
    );

    expect(await totalContributionCount()).toBe(1);

    const settled = await Activity.findById(activityId);
    expect(settled?.action).toBe(SupportedAction.ACTION_PAGE_REVERT);
  });

  it('does NOT count a recursive revert as a contribution, but still settles the action', async () => {
    const activityId = await settleViaUpdateListener(
      SupportedAction.ACTION_PAGE_RECURSIVELY_REVERT,
    );

    expect(await totalContributionCount()).toBe(0);

    const settled = await Activity.findById(activityId);
    expect(settled?.action).toBe(
      SupportedAction.ACTION_PAGE_RECURSIVELY_REVERT,
    );
  });
});
