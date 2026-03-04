import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ActivityLogActions } from '~/interfaces/activity';
import Activity from '~/server/models/activity';
import userFactory from '~/server/models/user';

import { ContributionCache } from '../models/contribution-cache-model';
import { formatDateKey, getISOWeekId } from '../utils/contribution-graph-utils';
import { ContributionCacheManager } from './cache-manager';

const createMockId = () => new mongoose.Types.ObjectId().toString();

describe('Contribution Cache Manager Integration Test', () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
    userFactory(null);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    await ContributionCache.deleteMany({});
    const User = mongoose.model('User');
    await User.deleteMany({});
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

    it('should remove cache weeks outside range', async () => {
      const userId = createMockId();

      const today = new Date();

      // Start of the 365-day window
      const startDateOfWindow = new Date(today);
      startDateOfWindow.setUTCDate(startDateOfWindow.getUTCDate() - 364);

      // An old date just outside the graph windows
      const outsideDate = new Date(startDateOfWindow);
      outsideDate.setUTCDate(outsideDate.getUTCDate() - 7);
      const outsideDateStr = formatDateKey(outsideDate);
      const weekIdToDelete = getISOWeekId(outsideDate);

      // A recent date
      const newDate = new Date(today);
      newDate.setUTCDate(newDate.getUTCDate() - 7);
      const newDateStr = formatDateKey(newDate);

      await Activity.create([
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: new Date(outsideDateStr),
        },
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_UPDATE,
          createdAt: new Date(outsideDateStr),
        },
      ]);

      await ContributionCache.create({
        userId,
        lastUpdated: new Date(newDateStr),
        currentWeekData: [{ date: newDateStr, count: 1 }],
        permanentWeeks: {
          [weekIdToDelete]: [{ date: outsideDateStr, count: 2 }],
        },
      });

      const result = await cacheManager.getUpdatedCache(userId);

      const oldDay = result.find((d) => d.date === outsideDateStr);
      const newDay = result.find((d) => d.date === newDateStr);

      const updatedCache = await ContributionCache.findOne({ userId });
      const hasOldWeekInDb = !!updatedCache?.permanentWeeks?.[weekIdToDelete];

      expect(hasOldWeekInDb).toBe(false);
      expect(result.length).toBe(365);
      expect(oldDay).toBeUndefined();
      expect(newDay).toBeDefined();
    });

    it('should freeze weeks between start of the graph until last week', async () => {
      const userId = createMockId();
      const User = mongoose.model('User');
      await User.create({ _id: userId, status: 1, username: 'testuser' });

      const today = new Date();

      // Date 7 days ago
      const pastDate = new Date(today);
      pastDate.setUTCDate(pastDate.getUTCDate() - 7);
      const pastDateStr = formatDateKey(pastDate);

      await Activity.create([
        {
          user: userId,
          action: ActivityLogActions.ACTION_PAGE_CREATE,
          createdAt: new Date(pastDateStr),
        },
      ]);

      const firstResult = await cacheManager.getUpdatedCache(userId);
      const firstCount = firstResult.find((d) => d.date === pastDateStr)?.count;
      expect(firstCount).toBe(1);

      // Create new activity on the same day
      await Activity.create({
        user: userId,
        action: ActivityLogActions.ACTION_PAGE_UPDATE,
        createdAt: new Date(pastDateStr),
      });

      const secondResult = await cacheManager.getUpdatedCache(userId);
      const secondCount = secondResult.find(
        (d) => d.date === pastDateStr,
      )?.count;

      expect(secondCount).toBe(1);
    });

    it('should throw error if user and contribution cache doesnt exist', async () => {
      const userId = createMockId();

      const newDate = new Date();
      newDate.setUTCDate(newDate.getUTCDate() - 7);

      await expect(cacheManager.getUpdatedCache(userId)).rejects.toThrowError(
        'User does not exist.',
      );
    });

    it('should return contribution cache if user exists', async () => {
      const userId = createMockId();
      const User = mongoose.model('User');
      await User.create({ _id: userId, status: 1, username: 'testuser' });

      const newDate = new Date();
      newDate.setUTCDate(newDate.getUTCDate() - 7);
      const newDateStr = formatDateKey(newDate);

      await ContributionCache.create({
        userId,
        lastUpdated: new Date(newDateStr),
        currentWeekData: [],
        permanentWeeks: {
          weekId: [],
        },
      });

      const result = await cacheManager.getUpdatedCache(userId);

      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      expect(result).toBeTruthy();
    });

    it('should return contribution cache if user exists but no contribution cache exist', async () => {
      const userId = createMockId();
      const User = mongoose.model('User');
      await User.create({ _id: userId, status: 1, username: 'testuser' });

      const result = await cacheManager.getUpdatedCache(userId);

      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      expect(result).toBeTruthy();
    });
  });
});
