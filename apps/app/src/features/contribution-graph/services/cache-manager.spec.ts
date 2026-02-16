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

      const today = new Date();

      // Start of the 365-day window
      const runner = new Date(today);
      runner.setUTCDate(runner.getUTCDate() - 364);
      const oldestDateInWindow = formatDateKey(runner);

      // A date near the beginning of the window
      const earlyDate = new Date(runner);
      earlyDate.setUTCDate(earlyDate.getUTCDate() + 5);
      const earlyDateStr = formatDateKey(earlyDate);

      // A date near the end of the window
      const recentDate = new Date(today);
      recentDate.setUTCDate(recentDate.getUTCDate() - 1);
      const recentDateStr = formatDateKey(recentDate);

      await Activity.create([
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: new Date(recentDateStr),
        },
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_UPDATE,
          createdAt: new Date(earlyDateStr),
        },
      ]);

      await ContributionCache.create({
        userId,
        lastUpdated: new Date(earlyDateStr),
        currentWeekData: [{ date: recentDateStr, count: 1 }],
        permanentWeeks: {
          'dynamic-week-id': [{ date: earlyDateStr, count: 1 }],
        },
      });

      const result = await cacheManager.getUpdatedCache(userId);

      expect(result[0].date).toBe(oldestDateInWindow);
      expect(result.length).toBe(365);

      const oldDay = result.find((d) => d.date === earlyDateStr);
      expect(oldDay).toBeDefined();
      expect(oldDay?.count).toBe(1);

      const newDay = result.find((d) => d.date === recentDateStr);
      expect(newDay).toBeDefined();
      expect(newDay?.count).toBe(1);
    });
  });
});
