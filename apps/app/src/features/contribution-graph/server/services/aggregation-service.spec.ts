import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ActivityLogActions } from '~/interfaces/activity';
import Activity from '~/server/models/activity';

import { ContributionAggregationService } from './aggregation-service';

describe('ContributionAggregationService (Essential)', () => {
  let service: ContributionAggregationService;
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    service = new ContributionAggregationService();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Activity.deleteMany({});
  });

  it('should aggregate real database records into daily counts', async () => {
    // Arrange
    const userId = new mongoose.Types.ObjectId();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-11-10T00:00:00Z'));

    await Activity.insertMany([
      {
        user: userId,
        action: ActivityLogActions.ACTION_PAGE_CREATE,
        createdAt: new Date('2025-11-01T12:00:00Z'),
      },
      {
        user: userId,
        action: ActivityLogActions.ACTION_PAGE_UPDATE,
        createdAt: new Date('2025-11-01T15:00:00Z'),
      },
      {
        user: userId,
        action: ActivityLogActions.ACTION_PAGE_CREATE,
        createdAt: new Date('2025-11-02T01:00:00Z'),
      },
    ]);

    // Act
    const results = await service.runAggregationPipeline({
      userId: userId.toString(),
      startDate: new Date('2025-11-01T00:00:00Z'),
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

    const userId = new mongoose.Types.ObjectId();
    await Activity.insertMany([
      {
        user: userId,
        action: ActivityLogActions.ACTION_PAGE_CREATE,
        createdAt: new Date('2025-10-31T23:59:59Z'), // Before
      },
      {
        user: userId,
        action: ActivityLogActions.ACTION_PAGE_CREATE,
        createdAt: new Date('2025-11-01T10:00:00Z'), // After
      },
    ]);

    const results = await service.runAggregationPipeline({
      userId: userId.toString(),
      startDate: new Date('2025-11-01T00:00:00Z'),
    });

    expect(results).toHaveLength(1);
    expect(results[0].date).toBe('2025-11-01');

    vi.useRealTimers();
  });

  it('should correctly separate activities occurring seconds apart across the midnight boundary', async () => {
    const userId = new mongoose.Types.ObjectId();

    // Define the midnight boundary
    const tuesdayLastSecond = new Date('2026-03-24T23:59:59Z');
    const wednesdayFirstSecond = new Date('2026-03-25T00:00:01Z');

    // Set "Now" to Wednesday afternoon for the test environment
    const mockNow = new Date('2026-03-25T15:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(mockNow);

    // Insert activities on both sides of the midnight boundary
    await Activity.insertMany([
      {
        user: userId,
        action: ActivityLogActions.ACTION_PAGE_CREATE,
        createdAt: tuesdayLastSecond,
      },
      {
        user: userId,
        action: ActivityLogActions.ACTION_PAGE_UPDATE,
        createdAt: wednesdayFirstSecond,
      },
    ]);

    // Run the pipeline starting from Monday
    const results = await service.runAggregationPipeline({
      userId: userId.toString(),
      startDate: new Date('2026-03-23T00:00:00Z'),
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
