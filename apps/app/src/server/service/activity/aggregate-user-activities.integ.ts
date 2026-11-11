/**
 * Integration tests — user-activities per-user aggregation (Prisma read path, req 3.2).
 *
 * `aggregateUserActivitiesLegacy` is the pure executor that receives a pipeline from
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
 * `aggregateUserActivitiesLegacy` exercises the exact production code path.
 *
 * Requires a real MongoDB connection (wired by vitest.workspace.mts integ setup).
 * These tests CANNOT run locally (no mongod binary / egress 403).
 * The local bar is: type-checks cleanly; CI (external MONGO_URI) exercises actual DB.
 *
 * Requirements: 3.2
 * Design: aggregate-user-activities executor; "Integration Tests（実 DB） 集計";
 *   "aggregateUserActivitiesLegacy(prisma, pipeline) returns { docs, totalCount }";
 *   "executor は pipeline を引数で受け取る".
 */

import mongoose, { Types } from 'mongoose';

import {
  ActivityLogActions,
  SupportedAction,
  type SupportedActivityActionType,
} from '~/interfaces/activity';
import { buildUserActivityPipeline } from '~/server/routes/apiv3/user-activities';
import {
  aggregateUserActivities,
  aggregateUserActivitiesLegacy,
  type UserActivityRow,
} from '~/server/service/activity/aggregate-user-activities';
import { toRawFilter } from '~/server/util/prisma-raw-normalize';
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

describe('aggregateUserActivitiesLegacy', () => {
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

    const pipeline = buildUserActivityPipeline(userA, { offset: 0, limit: 10 });

    // Act
    const result = await aggregateUserActivitiesLegacy(prisma, pipeline);

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
    const pipeline = buildUserActivityPipeline(userId, { offset: 1, limit: 2 });

    // Act
    const result = await aggregateUserActivitiesLegacy(prisma, pipeline);

    // Assert: totalCount is full count (5); docs is capped at limit (2)
    expect(result.totalCount).toBe(5);
    expect(result.docs).toHaveLength(2);
  });

  it('req 3.2 — returns totalCount=0 and empty docs when no activities match the user', async () => {
    // Arrange: no activities seeded for this user
    const userId = new Types.ObjectId().toHexString();

    const pipeline = buildUserActivityPipeline(userId, {
      offset: 0,
      limit: 10,
    });

    // Act
    const result = await aggregateUserActivitiesLegacy(prisma, pipeline);

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

    const pipeline = buildUserActivityPipeline(userId, {
      offset: 0,
      limit: 10,
    });

    // Act
    const result = await aggregateUserActivitiesLegacy(prisma, pipeline);

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

describe('aggregateUserActivities (three queries)', () => {
  const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
  const PATH_PREFIX = `/aggregate-user-activities-integ-${WORKER_ID}`;
  // A sentinel ip value so cleanup deletes only this block's rows.
  const SEED_IP = '10.0.0.71';

  const GRANT_PUBLIC = 1;
  const GRANT_OWNER = 4;

  const viewerId = new Types.ObjectId();
  const targetUserId = new Types.ObjectId().toHexString();
  const otherUserId = new Types.ObjectId().toHexString();
  const userWithoutActivityId = new Types.ObjectId().toHexString();
  const userOnHiddenPageOnlyId = new Types.ObjectId().toHexString();
  const userOnMissingPageOnlyId = new Types.ObjectId().toHexString();

  const makePage = (
    name: string,
    grant: number,
    grantedUsers: Types.ObjectId[] = [],
  ) => ({
    _id: new Types.ObjectId(),
    path: `${PATH_PREFIX}/${name}`,
    grant,
    grantedUsers,
    grantedGroups: [],
    status: 'published',
    // A field the rows must never carry.
    seenUsers: [viewerId],
  });

  const pages = {
    publicA: makePage('public-a', GRANT_PUBLIC),
    publicB: makePage('public-b', GRANT_PUBLIC),
    viewerOnlyMe: makePage('viewer-only-me', GRANT_OWNER, [viewerId]),
    othersOnlyMe: makePage('others-only-me', GRANT_OWNER, [
      new Types.ObjectId(),
    ]),
  };
  const missingPageId = new Types.ObjectId().toHexString();

  // Public pages and the pages granted to the viewer. Contains an ObjectId on
  // purpose, so that the filter has to survive the conversion for findRaw.
  const pageFilter = toRawFilter({
    $or: [
      { grant: GRANT_PUBLIC },
      { grant: GRANT_OWNER, grantedUsers: { $in: [viewerId] } },
    ],
  });

  const pagesCollection = () => mongoose.connection.collection('pages');

  const makeActivity = <A extends string>(
    userId: string,
    target: string,
    action: A,
    createdAt: Date,
  ) => ({
    id: new Types.ObjectId().toHexString(),
    v: 0,
    action,
    createdAt,
    endpoint: '/test/aggregate-user-activities',
    ip: SEED_IP,
    snapshot: { id: new Types.ObjectId().toHexString(), username: 'testuser' },
    userId,
    target,
    targetModel: 'Page',
  });

  const idOf = (page: { _id: Types.ObjectId }): string =>
    page._id.toHexString();

  const makeVisibleActivity = (
    page: { _id: Types.ObjectId; path: string },
    action: SupportedActivityActionType,
    createdAt: Date,
  ) => ({
    page,
    seed: makeActivity(targetUserId, idOf(page), action, createdAt),
  });

  const SAME_TIME = new Date('2025-09-03T00:00:00Z');

  // Every activity of the target user that the viewer may see.
  const visibleActivities = [
    makeVisibleActivity(
      pages.publicA,
      ActivityLogActions.ACTION_PAGE_CREATE,
      new Date('2025-09-01T00:00:00Z'),
    ),
    makeVisibleActivity(
      pages.publicA,
      ActivityLogActions.ACTION_PAGE_UPDATE,
      new Date('2025-09-02T00:00:00Z'),
    ),
    makeVisibleActivity(
      pages.publicA,
      ActivityLogActions.ACTION_PAGE_UPDATE,
      SAME_TIME,
    ),
    makeVisibleActivity(
      pages.publicB,
      ActivityLogActions.ACTION_PAGE_UPDATE,
      SAME_TIME,
    ),
    makeVisibleActivity(
      pages.publicA,
      ActivityLogActions.ACTION_PAGE_LIKE,
      SAME_TIME,
    ),
    makeVisibleActivity(
      pages.viewerOnlyMe,
      ActivityLogActions.ACTION_COMMENT_CREATE,
      SAME_TIME,
    ),
    makeVisibleActivity(
      pages.viewerOnlyMe,
      ActivityLogActions.ACTION_PAGE_RENAME,
      new Date('2025-09-04T00:00:00Z'),
    ),
  ];

  const hiddenActivities = [
    makeActivity(
      targetUserId,
      idOf(pages.othersOnlyMe),
      ActivityLogActions.ACTION_PAGE_UPDATE,
      new Date('2025-09-05T00:00:00Z'),
    ),
    makeActivity(
      targetUserId,
      missingPageId,
      ActivityLogActions.ACTION_PAGE_UPDATE,
      new Date('2025-09-06T00:00:00Z'),
    ),
    // An action outside ActivityLogActions, on a visible page.
    makeActivity(
      targetUserId,
      idOf(pages.publicA),
      SupportedAction.ACTION_PAGE_BOOKMARK,
      new Date('2025-09-07T00:00:00Z'),
    ),
    makeActivity(
      otherUserId,
      idOf(pages.publicA),
      ActivityLogActions.ACTION_PAGE_UPDATE,
      new Date('2025-09-08T00:00:00Z'),
    ),
    makeActivity(
      userOnHiddenPageOnlyId,
      idOf(pages.othersOnlyMe),
      ActivityLogActions.ACTION_PAGE_UPDATE,
      new Date('2025-09-09T00:00:00Z'),
    ),
    makeActivity(
      userOnMissingPageOnlyId,
      missingPageId,
      ActivityLogActions.ACTION_PAGE_UPDATE,
      new Date('2025-09-09T00:00:00Z'),
    ),
  ];

  // Newest first; activities with the same createdAt in descending id order.
  const expectedRows: UserActivityRow[] = [...visibleActivities]
    .sort(
      (a, b) =>
        b.seed.createdAt.getTime() - a.seed.createdAt.getTime() ||
        (a.seed.id < b.seed.id ? 1 : -1),
    )
    .map(({ page, seed }) => ({
      _id: seed.id,
      action: seed.action,
      createdAt: seed.createdAt,
      target: { _id: idOf(page), path: page.path },
    }));

  // Requests page after page until an empty one comes back.
  const fetchAllPages = async (
    limit: number,
    offset = 0,
  ): Promise<{ docs: UserActivityRow[]; totalCounts: number[] }> => {
    const page = await aggregateUserActivities(prisma, {
      targetUserId,
      pageFilter,
      limit,
      offset,
    });
    if (page.docs.length === 0) {
      return { docs: [], totalCounts: [page.totalCount] };
    }
    const rest = await fetchAllPages(limit, offset + limit);
    return {
      docs: [...page.docs, ...rest.docs],
      totalCounts: [page.totalCount, ...rest.totalCounts],
    };
  };

  beforeAll(async () => {
    await pagesCollection().insertMany(Object.values(pages));
    await prisma.activities.createMany({
      data: [...visibleActivities.map(({ seed }) => seed), ...hiddenActivities],
    });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: SEED_IP } });
    await pagesCollection().deleteMany({
      _id: { $in: Object.values(pages).map((page) => page._id) },
    });
  });

  it('returns, newest first, exactly the rows of the target user on pages matching the filter, with only the defined fields', async () => {
    const result = await aggregateUserActivities(prisma, {
      targetUserId,
      pageFilter,
      limit: 100,
      offset: 0,
    });

    expect(result.docs).toStrictEqual(expectedRows);
    expect(result.totalCount).toBe(expectedRows.length);
  });

  it('returns every activity on the same page as its own row and counts it', async () => {
    const result = await aggregateUserActivities(prisma, {
      targetUserId,
      pageFilter,
      limit: 100,
      offset: 0,
    });

    const rowsOnPublicA = result.docs.filter(
      (row) => row.target._id === idOf(pages.publicA),
    );
    expect(rowsOnPublicA).toHaveLength(4);
    expect(result.totalCount).toBe(7);
  });

  it.each([
    1, 2, 3,
  ])('pages through all rows without duplicates or gaps, with a constant totalCount (limit %i)', async (limit) => {
    const { docs, totalCounts } = await fetchAllPages(limit);

    expect(docs.map((row) => row._id)).toStrictEqual(
      expectedRows.map((row) => row._id),
    );
    expect(new Set(totalCounts)).toStrictEqual(new Set([docs.length]));
  });

  it('never returns activities on a page that does not match the filter or does not exist', async () => {
    const { docs } = await fetchAllPages(100);

    const targetIds = docs.map((row) => row.target._id);
    expect(targetIds).not.toContain(idOf(pages.othersOnlyMe));
    expect(targetIds).not.toContain(missingPageId);
  });

  it('answers the same for a user acting only on a hidden page and a user acting only on a missing page', async () => {
    const onHiddenPage = await aggregateUserActivities(prisma, {
      targetUserId: userOnHiddenPageOnlyId,
      pageFilter,
      limit: 100,
      offset: 0,
    });
    const onMissingPage = await aggregateUserActivities(prisma, {
      targetUserId: userOnMissingPageOnlyId,
      pageFilter,
      limit: 100,
      offset: 0,
    });

    expect(onHiddenPage).toStrictEqual({ docs: [], totalCount: 0 });
    expect(onMissingPage).toStrictEqual(onHiddenPage);
  });

  it('returns no rows and totalCount 0 when the target user has no activity', async () => {
    const result = await aggregateUserActivities(prisma, {
      targetUserId: userWithoutActivityId,
      pageFilter,
      limit: 100,
      offset: 0,
    });

    expect(result).toStrictEqual({ docs: [], totalCount: 0 });
  });

  it('returns no rows and totalCount 0 when no page matches the filter', async () => {
    const result = await aggregateUserActivities(prisma, {
      targetUserId,
      pageFilter: { path: `${PATH_PREFIX}/matches-no-page` },
      limit: 100,
      offset: 0,
    });

    expect(result).toStrictEqual({ docs: [], totalCount: 0 });
  });
});
