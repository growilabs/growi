import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ActivityLogActions } from '~/interfaces/activity';
import Activity from '~/server/models/activity';

import { ContributionCache } from '../models/contribution-cache-model';
import { ContributionCacheManager } from './cache-manager';

const createMockId = () => new mongoose.Types.ObjectId().toString();

describe('Contribution Cache Manager Integration Test', () => {
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

  describe('getUpdatedCache()', () => {
    const cacheManager = new ContributionCacheManager();

    it('should return an array of all combined contribution cache for a user', async () => {
      const userId = createMockId();

      await Activity.create([
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE, // Or any valid action from your enum
          createdAt: new Date('2025-01-06'),
        },
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_UPDATE,
          createdAt: new Date('2025-01-01'),
        },
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_UPDATE,
          createdAt: new Date('2024-12-23'),
        },
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_UPDATE,
          createdAt: new Date('2024-12-24'),
        },
      ]);

      await ContributionCache.create({
        userId,
        lastUpdated: new Date('2025-01-01'),
        currentWeekData: [
          { date: '2025-01-06', count: 1 }, // Monday of a later week
        ],
        permanentWeeks: {
          '2024-W52': [
            { date: '2024-12-23', count: 1 },
            { date: '2024-12-24', count: 1 },
          ],
        },
      });

      const result = await cacheManager.getUpdatedCache(userId);

      const oldDay = result.find((d) => d.date === '2024-12-23');
      expect(oldDay).toBeDefined();
      expect(oldDay?.count).toBe(10);

      // Check if the new current week data is present
      const newDay = result.find((d) => d.date === '2025-01-06');
      expect(newDay).toBeDefined();
      expect(newDay?.count).toBe(5);

      // Check Order: The first element should be the oldest date
      expect(result[0].date).toBe('2024-12-23');

      // Check that gaps were filled (fillGapsInWeek should have added the rest of the week)
      // 7 days from permanent week + 7 days from current week = 14 total
      expect(result.length).toBeGreaterThanOrEqual(14);
    });
  });
});
