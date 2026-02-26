import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { SetContributionCachePayload } from '../interfaces/contribution-graph';
import { ContributionCache } from '../models/contribution-cache-model';
import { getUTCMidnightToday } from '../utils/contribution-graph-utils';
import {
  cacheIsFresh,
  getContributionCache,
  updateContributionCache,
} from './cache-data-service';

const createMockId = () => new mongoose.Types.ObjectId().toString();

describe('Contribution Cache Integration Test', () => {
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

  describe('updateContributionCache()', () => {
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

      expect(doc?.permanentWeeks.get('old_week')).toBeUndefined();
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

  describe('getContributionCache()', () => {
    it('should return the correct contribution cache for a user', async () => {
      const userId = createMockId();

      await ContributionCache.create({
        userId: userId,
        currentWeekData: [{ date: '2025-01-01', count: 1 }],
        permanentWeeks: {
          old_week: [{ date: '2024-01-01', count: 99 }],
        },
        lastUpdated: new Date(),
      });

      const result = await getContributionCache(userId);

      if (!result) {
        throw new Error('Cannot get contribution cache.');
      }
      expect(result).not.toBeNull();
      expect(result.userId.toString()).toBe(userId.toString());
      expect(result.currentWeekData[0].count).toBe(1);
    });

    it('should return null if user is not found', async () => {
      const userId = createMockId();
      const nonExistingUser = createMockId();

      await ContributionCache.create({
        userId: userId,
        currentWeekData: [{ date: '2025-01-01', count: 1 }],
        permanentWeeks: {
          old_week: [{ date: '2024-01-01', count: 99 }],
        },
        lastUpdated: new Date(),
      });

      const result = await getContributionCache(nonExistingUser);

      expect(result).toBe(null);
    });

    it('should return null if user argument is invalid', async () => {
      const userId = createMockId();
      const invalidUserId = 'user_string';

      await ContributionCache.create({
        userId: userId,
        currentWeekData: [{ date: '2025-01-01', count: 1 }],
        permanentWeeks: {
          old_week: [{ date: '2024-01-01', count: 99 }],
        },
        lastUpdated: new Date(),
      });

      const result = await getContributionCache(invalidUserId);

      expect(result).toBe(null);
    });
  });
});

describe('cacheIsFresh()', () => {
  it('should return true if cache is newer than 00:00 today', () => {
    const freshCacheDate = new Date();
    const result = cacheIsFresh(freshCacheDate);

    expect(result).toBe(true);
  });

  it('should return false if cache is exactly one second before today midnight', () => {
    const todayMidnight = getUTCMidnightToday();
    const oneSecondBefore = new Date(todayMidnight.getTime() - 1000);
    const result = cacheIsFresh(oneSecondBefore);

    expect(result).toBe(false);
  });
});
