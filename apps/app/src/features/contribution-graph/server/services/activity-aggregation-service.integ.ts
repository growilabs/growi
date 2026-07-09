/**
 * Integration tests — contribution-graph daily aggregation (Prisma read path).
 *
 * `getContributionActivities` now reads via the `aggregate-contributions` pure
 * executor (`prisma.activities.aggregateRaw`). These tests seed activities via
 * `prisma.activities.createMany` (explicit `_id` ObjectId strings — research R4)
 * into the same per-worker test DB that the integration `prisma` setup
 * (`test/setup/prisma.ts`) binds the Prisma client to, then assert the observable
 * day-bucket aggregation contract is unchanged from the Mongoose implementation.
 *
 * Requires a real MongoDB connection (wired by vitest.workspace.mts integ setup).
 * These tests CANNOT run locally (no mongod binary / egress 403).
 * The local bar is: type-checks cleanly; CI (external MONGO_URI) exercises actual DB.
 *
 * Requirements: 3.1
 * Design: aggregate-contributions executor; "既存の integ テスト
 *   (activity-aggregation-service.spec…) は insertMany→createMany／find→executor へ追随".
 */

import { Types } from 'mongoose';

import { ActivityLogActions } from '~/interfaces/activity';
import { prisma } from '~/utils/prisma';

import { getContributionActivities } from './activity-aggregation-service';

// A sentinel ip value so cleanup deletes only this suite's rows.
const TEST_IP = '10.0.0.55';

/** Build a minimal activities record for seeding via prisma.activities.createMany. */
function makeActivityData(overrides: {
  userId: string;
  action: string;
  createdAt: Date;
}) {
  return {
    id: new Types.ObjectId().toHexString(),
    v: 0,
    action: overrides.action,
    createdAt: overrides.createdAt,
    endpoint: '/test/contribution-aggregation',
    ip: TEST_IP,
    snapshot: { id: new Types.ObjectId().toHexString(), username: 'testuser' },
    userId: overrides.userId,
  };
}

describe('getContributionActivities', () => {
  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  it('should aggregate real database records into daily counts', async () => {
    // Arrange
    const userId = new Types.ObjectId().toHexString();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-11-10T00:00:00Z'));

    await prisma.activities.createMany({
      data: [
        makeActivityData({
          userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: new Date('2025-11-01T12:00:00Z'),
        }),
        makeActivityData({
          userId,
          action: ActivityLogActions.ACTION_PAGE_UPDATE,
          createdAt: new Date('2025-11-01T15:00:00Z'),
        }),
        makeActivityData({
          userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: new Date('2025-11-02T01:00:00Z'),
        }),
      ],
    });

    // Act
    const results = await getContributionActivities({
      userId,
      startDate: new Date('2025-11-01T00:00:00Z'),
      endDate: new Date(),
    });

    // Assert: Verify the final outcome
    expect(results).toHaveLength(2);
    expect(results).toEqual(
      expect.arrayContaining([
        { date: '2025-11-01', count: 2 },
        { date: '2025-11-02', count: 1 },
      ]),
    );

    vi.useRealTimers();
  });

  it('should exclude records before the startDate', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-11-10T00:00:00Z'));

    const userId = new Types.ObjectId().toHexString();
    await prisma.activities.createMany({
      data: [
        makeActivityData({
          userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: new Date('2025-10-31T23:59:59Z'), // Before
        }),
        makeActivityData({
          userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: new Date('2025-11-01T10:00:00Z'), // After
        }),
      ],
    });

    const results = await getContributionActivities({
      userId,
      startDate: new Date('2025-11-01T00:00:00Z'),
      endDate: new Date(),
    });

    expect(results).toHaveLength(1);
    expect(results[0].date).toBe('2025-11-01');

    vi.useRealTimers();
  });

  it('should correctly separate activities occurring seconds apart across the midnight boundary', async () => {
    const userId = new Types.ObjectId().toHexString();

    // Define the midnight boundary
    const tuesdayLastSecond = new Date('2026-03-24T23:59:59Z');
    const wednesdayFirstSecond = new Date('2026-03-25T00:00:01Z');

    // Set "Now" to Wednesday afternoon for the test environment
    const mockNow = new Date('2026-03-25T15:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(mockNow);

    // Insert activities on both sides of the midnight boundary
    await prisma.activities.createMany({
      data: [
        makeActivityData({
          userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: tuesdayLastSecond,
        }),
        makeActivityData({
          userId,
          action: ActivityLogActions.ACTION_PAGE_UPDATE,
          createdAt: wednesdayFirstSecond,
        }),
      ],
    });

    // Run the pipeline starting from Monday
    const results = await getContributionActivities({
      userId,
      startDate: new Date('2026-03-23T00:00:00Z'),
      endDate: new Date(),
    });

    // We expect two distinct entries in the results
    const tuesdayEntry = results.find((r) => r.date === '2026-03-24');
    const wednesdayEntry = results.find((r) => r.date === '2026-03-25');

    expect(tuesdayEntry).toBeDefined();
    expect(tuesdayEntry?.count).toBe(1);

    expect(wednesdayEntry).toBeDefined();
    expect(wednesdayEntry?.count).toBe(1);

    expect(results.length).toBe(2);

    vi.useRealTimers();
  });
});
