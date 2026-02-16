import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ActivityLogActions } from '~/interfaces/activity';
import Activity from '~/server/models/activity';

import { ContributionCache } from '../models/contribution-cache-model';
import { formatDateKey } from '../utils/contribution-graph-utils';
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

      // REMINDER: Make test that works with future dates

      await Activity.create([
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: new Date('2025-03-06'),
        },
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_UPDATE,
          createdAt: new Date('2025-03-01'),
        },
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_UPDATE,
          createdAt: new Date('2025-12-23'),
        },
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_UPDATE,
          createdAt: new Date('2025-12-24'),
        },
      ]);

      await ContributionCache.create({
        userId,
        lastUpdated: new Date('2025-03-01'),
        currentWeekData: [{ date: '2025-03-06', count: 1 }],
        permanentWeeks: {
          '2025-W52': [
            { date: '2025-12-23', count: 1 },
            { date: '2025-12-24', count: 1 },
          ],
        },
      });

      const result = await cacheManager.getUpdatedCache(userId);
      const runner = new Date();
      runner.setUTCDate(runner.getUTCDate() - 364);
      const oldestDate = formatDateKey(runner);

      const oldDay = result.find((d) => d.date === '2025-12-23');
      expect(oldDay).toBeDefined();
      expect(oldDay?.count).toBe(1);

      // Check if the new current week data is present
      const newDay = result.find((d) => d.date === '2025-03-06');
      expect(newDay).toBeDefined();
      expect(newDay?.count).toBe(1);

      // Check Order: The first element should be the oldest date
      expect(result[0].date).toBe(oldestDate);
      expect(result.length).toBeGreaterThanOrEqual(14);
    });
  });
});
