/**
 * Integration tests — user-activities per-user aggregation (Prisma read path, req 3.2).
 *
 * `aggregateUserActivities` is the pure executor that receives a pipeline from
 * its caller (the apiv3/user-activities.ts route) and runs it via
 * `prisma.activities.aggregateRaw`.  These tests seed activities via
 * `prisma.activities.createMany` (explicit `_id` ObjectId strings — research R4)
 * into the same per-worker test DB that the integration `prisma` setup
 * (`test/setup/prisma.ts`) binds the Prisma client to, then assert the observable
 * contracts:
 *
 *   - The executor returns `{ docs, totalCount }` reflecting exactly the seeded
 *     records that match the given userId filter (req 3.2).
 *   - Pagination via $skip / $limit inside the pipeline is respected (req 3.2).
 *   - Users from different userId values are not mixed in the result (req 3.2).
 *   - An empty result when no records match is handled gracefully (totalCount = 0).
 *
 * The pipeline shape is the same $facet/$lookup/$project pipeline that the
 * apiv3/user-activities.ts route constructs; passing it directly to
 * `aggregateUserActivities` exercises the exact production code path.
 *
 * Requires a real MongoDB connection (wired by vitest.workspace.mts integ setup).
 * These tests CANNOT run locally (no mongod binary / egress 403).
 * The local bar is: type-checks cleanly; CI (external MONGO_URI) exercises actual DB.
 *
 * Requirements: 3.2
 * Design: aggregate-user-activities executor; "Integration Tests（実 DB） 集計";
 *   "aggregateUserActivities(prisma, pipeline) returns { docs, totalCount }";
 *   "executor は pipeline を引数で受け取る".
 */

import { Types } from 'mongoose';

import { ActivityLogActions } from '~/interfaces/activity';
import { aggregateUserActivities } from '~/server/service/activity/aggregate-user-activities';
import { prisma } from '~/utils/prisma';

// A sentinel ip value so cleanup deletes only this suite's rows.
const TEST_IP = '10.0.0.70';

/** Build a minimal activities record for seeding via prisma.activities.createMany. */
function makeActivityData(overrides: {
  userId: string;
  action: string;
  createdAt?: Date;
}) {
  return {
    id: new Types.ObjectId().toHexString(),
    v: 0,
    action: overrides.action,
    createdAt: overrides.createdAt ?? new Date(),
    endpoint: '/test/user-activities-aggregation',
    ip: TEST_IP,
    snapshot: { id: new Types.ObjectId().toHexString(), username: 'testuser' },
    userId: overrides.userId,
  };
}

/**
 * Build the same $facet/$lookup/$project pipeline that apiv3/user-activities.ts
 * constructs at runtime — this exercises the exact production code path.
 *
 * Note: `user` in the pipeline refers to the `userId` field (stored as ObjectId
 * in the raw collection under the key `user` — the Mongoose field name).
 */
function buildUserActivityPipeline(
  userId: string,
  offset: number,
  limit: number,
): Record<string, unknown>[] {
  // Use Types.ObjectId to match the production code in user-activities.ts which
  // passes `new Types.ObjectId(targetUserId)` into $match.user — same form here.
  const userObjectId = new Types.ObjectId(userId);

  return [
    {
      $match: {
        user: userObjectId,
        action: { $in: Object.values(ActivityLogActions) },
      },
    },
    {
      $facet: {
        totalCount: [{ $count: 'count' }],
        docs: [
          { $sort: { createdAt: -1 } },
          { $skip: offset },
          { $limit: limit },
          {
            $lookup: {
              from: 'pages',
              localField: 'target',
              foreignField: '_id',
              as: 'target',
            },
          },
          {
            $unwind: {
              path: '$target',
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $lookup: {
              from: 'users',
              localField: 'user',
              foreignField: '_id',
              as: 'user',
            },
          },
          {
            $unwind: {
              path: '$user',
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $project: {
              _id: 1,
              'user._id': 1,
              'user.username': 1,
              'user.name': 1,
              'user.imageUrlCached': 1,
              action: 1,
              createdAt: 1,
              target: 1,
              targetModel: 1,
            },
          },
        ],
      },
    },
  ];
}

describe('aggregateUserActivities', () => {
  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  it('req 3.2 — returns docs and totalCount for activities matching the target user', async () => {
    // Arrange: seed 3 activities for user A and 1 for user B
    const userA = new Types.ObjectId().toHexString();
    const userB = new Types.ObjectId().toHexString();

    await prisma.activities.createMany({
      data: [
        makeActivityData({
          userId: userA,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: new Date('2025-06-01T10:00:00Z'),
        }),
        makeActivityData({
          userId: userA,
          action: ActivityLogActions.ACTION_PAGE_UPDATE,
          createdAt: new Date('2025-06-02T10:00:00Z'),
        }),
        makeActivityData({
          userId: userA,
          action: ActivityLogActions.ACTION_PAGE_DELETE,
          createdAt: new Date('2025-06-03T10:00:00Z'),
        }),
        makeActivityData({
          userId: userB,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: new Date('2025-06-01T12:00:00Z'),
        }),
      ],
    });

    const pipeline = buildUserActivityPipeline(userA, 0, 10);

    // Act
    const result = await aggregateUserActivities(prisma, pipeline);

    // Assert: observable contracts — totalCount counts only userA's activities;
    // docs contains only userA's activities.
    expect(result.totalCount).toBe(3);
    expect(result.docs).toHaveLength(3);
  });

  it('req 3.2 — pagination: $skip/$limit inside the pipeline limits returned docs', async () => {
    // Arrange: seed 5 activities for a single user
    const userId = new Types.ObjectId().toHexString();

    const now = new Date('2025-07-01T00:00:00Z');
    await prisma.activities.createMany({
      data: Array.from({ length: 5 }, (_, i) =>
        makeActivityData({
          userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: new Date(now.getTime() + i * 1000),
        }),
      ),
    });

    // Limit to 2 docs starting from offset 1
    const pipeline = buildUserActivityPipeline(userId, 1, 2);

    // Act
    const result = await aggregateUserActivities(prisma, pipeline);

    // Assert: totalCount is full count (5); docs is capped at limit (2)
    expect(result.totalCount).toBe(5);
    expect(result.docs).toHaveLength(2);
  });

  it('req 3.2 — returns totalCount=0 and empty docs when no activities match the user', async () => {
    // Arrange: no activities seeded for this user
    const userId = new Types.ObjectId().toHexString();

    const pipeline = buildUserActivityPipeline(userId, 0, 10);

    // Act
    const result = await aggregateUserActivities(prisma, pipeline);

    // Assert: graceful empty result (no throw, sensible defaults)
    expect(result.totalCount).toBe(0);
    expect(result.docs).toHaveLength(0);
  });

  it('req 3.2 — docs are returned in descending createdAt order (newest first)', async () => {
    // Arrange: seed 3 activities at distinct times
    const userId = new Types.ObjectId().toHexString();

    await prisma.activities.createMany({
      data: [
        makeActivityData({
          userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: new Date('2025-08-01T08:00:00Z'),
        }),
        makeActivityData({
          userId,
          action: ActivityLogActions.ACTION_PAGE_UPDATE,
          createdAt: new Date('2025-08-01T09:00:00Z'),
        }),
        makeActivityData({
          userId,
          action: ActivityLogActions.ACTION_PAGE_DELETE,
          createdAt: new Date('2025-08-01T10:00:00Z'),
        }),
      ],
    });

    const pipeline = buildUserActivityPipeline(userId, 0, 10);

    // Act
    const result = await aggregateUserActivities(prisma, pipeline);

    // Assert: the pipeline sorts by { createdAt: -1 } — latest first
    expect(result.docs).toHaveLength(3);

    // The $project removes createdAt from the facet-docs output only if it is
    // excluded.  The pipeline above includes `createdAt: 1` in $project, so it
    // should be present.  We verify ordering by comparing the action values
    // which we know map to specific timestamps.
    const actions = (result.docs as Array<{ action: string }>).map(
      (d) => d.action,
    );
    expect(actions[0]).toBe(ActivityLogActions.ACTION_PAGE_DELETE); // newest
    expect(actions[2]).toBe(ActivityLogActions.ACTION_PAGE_CREATE); // oldest
  });
});
