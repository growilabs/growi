import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type SetContributionCachePayload,
  updateContributionCache,
} from './cache-data-service';
import { ContributionCache } from './models/contribution-cache-model';

const createMockId = () => new mongoose.Types.ObjectId().toString();

describe('updateContributionCache Integration Test', () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    await ContributionCache.deleteMany({});
  });

  it('should actually create and update a document in the DB', async () => {
    const userId = createMockId();
    const payload: SetContributionCachePayload = {
      userId,
      newCurrentWeek: [
        { date: '2025-01-04', count: 5 },
        { date: '2025-01-05', count: 1 },
      ],
      weeksToFreeze: [
        {
          id: '2024-W53',
          data: [{ date: '2024-12-25', count: 10 }],
        },
      ],
    };

    await updateContributionCache(payload);

    const doc = await ContributionCache.findOne({ userId }).lean();

    expect(doc).toBeDefined();
    expect(doc?.currentWeekData[0].count).toBe(5);
    expect(doc?.currentWeekData[0].date).toBe('2025-01-04');

    const frozenWeek = doc?.permanentWeeks['2024-W53'];

    if (frozenWeek == null) {
      throw new Error('frozenWeek was not found in the document');
    }

    expect(frozenWeek).toBeDefined();
    expect(frozenWeek[0].count).toBe(10);
  });

  it('should unset a week correctly in the real document', async () => {
    const userId = createMockId();

    await ContributionCache.create({
      userId: userId,
      currentWeekData: [{ date: '2025-01-01', count: 1 }],
      permanentWeeks: {
        old_week: [{ date: '2024-01-01', count: 99 }],
      },
      lastUpdated: new Date(),
    });

    await updateContributionCache({
      userId: userId,
      newCurrentWeek: [{ date: '2025-01-01', count: 2 }],
      weekIdsToDelete: ['old_week'],
    });

    const doc = await ContributionCache.findOne({ userId: userId });

    expect(doc?.permanentWeeks.old_week).toBeUndefined();
    expect(doc?.currentWeekData[0].count).toBe(2);
  });

  it('should handle multiple freezes and deletes simultaneously', async () => {
    const userId = createMockId();
    const startTime = new Date();

    const payload: SetContributionCachePayload = {
      userId,
      newCurrentWeek: [{ date: '2025-01-01', count: 1 }],
      weeksToFreeze: [
        { id: 'week-1', data: [{ date: '2024-01-01', count: 10 }] },
        { id: 'week-2', data: [{ date: '2024-01-08', count: 20 }] },
      ],
    };

    await updateContributionCache(payload);

    const doc = await ContributionCache.findOne({ userId }).lean();

    expect(doc?.permanentWeeks?.['week-1']).toBeDefined();
    expect(doc?.permanentWeeks?.['week-2']).toBeDefined();
    expect(doc?.permanentWeeks?.['week-2'][0].count).toBe(20);
    expect(doc?.lastUpdated.getTime()).toBeGreaterThanOrEqual(
      startTime.getTime(),
    );
  });
});
