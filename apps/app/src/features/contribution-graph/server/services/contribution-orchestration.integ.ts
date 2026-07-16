/**
 * Integration tests — full contribution orchestration via the real ActivityService
 * 'update' handler (Prisma read + write path).
 *
 * The handler resolves the contributor (`prisma.activities.findUnique`), runs the
 * migration/contribution sequence, then settles the activity by CREATING it
 * lazily (`settleActivityRecord` -> `prisma.activities.createByParameters`,
 * Option C / lazy fail-safe) using the id `beginActivity` pre-mints. Activities
 * are therefore read back via Prisma from the same per-worker test DB the
 * integration `prisma` setup (`test/setup/prisma.ts`) binds the client to;
 * Mongoose (`User` / `Contribution`) is connected to that SAME DB by the
 * integration mongo setup. Observable contracts (contribution counts, settled
 * action) are unchanged from the Mongoose implementation.
 *
 * Requires a real MongoDB connection (wired by vitest.workspace.mts integ setup).
 * These tests CANNOT run locally (no mongod binary / egress 403).
 * The local bar is: type-checks cleanly; CI (external MONGO_URI) exercises actual DB.
 *
 * Requirements: 3.1
 * Design: aggregate-contributions executor; contribution-migration-service
 *   findById→findUnique; "既存の integ テスト … は insertMany→createMany／find→executor へ追随".
 */

import { EventEmitter } from 'node:events';
import type { IUser } from '@growi/core';
import mongoose, { Types } from 'mongoose';

import {
  SupportedAction,
  type SupportedActionType,
} from '~/interfaces/activity';
import ActivityService from '~/server/service/activity';
import { beginActivity } from '~/server/service/activity/index';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import Contribution from '../models/contribution-model';

// Set the Activity TTL to the 30-day default
vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: vi.fn() },
}));
vi.mocked(configManager.getConfig).mockReturnValue(2592000);

// Minimal User schema (the fields the migration logic reads, plus `username`
// and timestamps) -- required because ActivityExtension.updateByParameters
// always does `include: { user: true }` [Key Decision 5], and the real
// `users` Prisma model declares `username`/`createdAt`/`updatedAt`
// non-nullable; a seeded User missing any of them makes the settle-update's
// relation fetch throw P2032. Guarded against duplicate registration across
// specs in the same process.
if (mongoose.models.User == null) {
  mongoose.model(
    'User',
    new mongoose.Schema(
      {
        username: { type: String },
        contributionsMigratedAt: { type: Date },
      },
      { timestamps: true },
    ),
  );
}
const User = mongoose.model<IUser>('User');

// A sentinel ip value so cleanup deletes only this suite's seeded activities.
const TEST_IP = '10.0.0.57';

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
    // settleActivityRecord's createByParameters runs to settle the activity.
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
  const userId = new Types.ObjectId();
  const pageId = new Types.ObjectId();

  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    await Contribution.deleteMany({});
    await User.deleteMany({});
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    await Contribution.deleteMany({});
    await User.deleteMany({});
  });

  /**
   * Arrange an un-migrated user, then drive the real 'update' handler with
   * the given action. Under Option C (lazy fail-safe) the listener CREATES
   * the Activity row itself (settleActivityRecord -> createByParameters)
   * using the id `beginActivity` pre-mints -- it must NOT be pre-created by
   * the test, or the listener's create collides on the same id (P2002),
   * which the listener's generic catch swallows (logs and returns), leaving
   * no settled row at all. `beginActivity` also stashes the request-time
   * context that the listener's synchronous `pendingActivityContext.take()`
   * reads back. The handler runs the full resolveContributor ->
   * ensureUserHasMigrated -> addContribution sequence and then settles
   * (creates) the activity. Returns the activity id so callers can assert
   * on the settled action.
   */
  const settleViaUpdateListener = async (
    action: SupportedActionType,
  ): Promise<string> => {
    await User.create({ _id: userId, username: 'testuser' }); // un-migrated user

    const { activityId } = beginActivity({
      ip: TEST_IP,
      endpoint: '/test/contribution-orchestration',
      userId: userId.toHexString(),
      username: 'testuser',
      createdAt: new Date(),
    });

    const updateListener = buildUpdateListener();
    await updateListener(
      activityId,
      { action, target: pageId, contributor: { _id: userId } },
      { _id: pageId },
    );

    return activityId;
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

    const settled = await prisma.activities.findFirst({
      where: { id: activityId },
    });
    expect(settled?.action).toBe(SupportedAction.ACTION_PAGE_CREATE);
  });

  it('counts a single-page revert as a contribution and settles the action', async () => {
    const activityId = await settleViaUpdateListener(
      SupportedAction.ACTION_PAGE_REVERT,
    );

    expect(await totalContributionCount()).toBe(1);

    const settled = await prisma.activities.findFirst({
      where: { id: activityId },
    });
    expect(settled?.action).toBe(SupportedAction.ACTION_PAGE_REVERT);
  });

  it('does NOT count a recursive revert as a contribution, but still settles the action', async () => {
    const activityId = await settleViaUpdateListener(
      SupportedAction.ACTION_PAGE_RECURSIVELY_REVERT,
    );

    expect(await totalContributionCount()).toBe(0);

    const settled = await prisma.activities.findFirst({
      where: { id: activityId },
    });
    expect(settled?.action).toBe(
      SupportedAction.ACTION_PAGE_RECURSIVELY_REVERT,
    );
  });
});
